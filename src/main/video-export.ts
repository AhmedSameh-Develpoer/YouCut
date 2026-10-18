import { spawn, type ChildProcess } from 'node:child_process'
import { access, readdir, copyFile, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, dirname, basename, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import type { ExportOptions, ExportJob, FaceCamSettings, FramingKeyframe } from '../shared/contracts'

export async function findFfmpeg() {
  if (process.env.FFMPEG_PATH) { await access(process.env.FFMPEG_PATH); return process.env.FFMPEG_PATH }
  const root = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Microsoft', 'WinGet', 'Packages')
  try {
    for (const entry of await readdir(root)) {
      if (!entry.startsWith('Gyan.FFmpeg')) continue
      const directory = join(root, entry)
      for (const version of await readdir(directory)) {
        const executable = join(directory, version, 'bin', 'ffmpeg.exe')
        try { await access(executable); return executable } catch { /* try next installed version */ }
      }
    }
  } catch { /* fall back to PATH */ }
  const commonProgramFiles = process.env.COMMONPROGRAMFILES || process.env['CommonProgramFiles']
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const localPrograms = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Programs')
  const candidates = [
    join(programFiles, 'FFmpeg', 'bin', 'ffmpeg.exe'),
    join(localPrograms, 'FFmpeg', 'bin', 'ffmpeg.exe'),
    ...(commonProgramFiles ? [join(commonProgramFiles, 'FFmpeg', 'bin', 'ffmpeg.exe')] : []),
  ]
  for (const executable of candidates) {
    try { await access(executable); return executable } catch { /* try next known installation root */ }
  }
  if (commonProgramFiles) {
    const queue = [{ path: commonProgramFiles, depth: 0 }]
    while (queue.length) {
      const current = queue.shift()!
      if (current.depth > 3) continue
      try {
        for (const entry of await readdir(current.path, { withFileTypes: true })) {
          const candidate = join(current.path, entry.name)
          if (entry.isFile() && entry.name.toLowerCase() === 'ffmpeg.exe') return candidate
          if (entry.isDirectory() && current.depth < 3) queue.push({ path: candidate, depth: current.depth + 1 })
        }
      } catch { /* Skip protected or disconnected installation directories. */ }
    }
  }
  return 'ffmpeg'
}
async function probeWithFfprobe(probe: string, path: string) {
  return new Promise<{ duration: number; fps: number }>((resolve, reject) => {
    const child = spawn(probe, ['-v','error','-show_entries','format=duration:stream=codec_type,avg_frame_rate','-of','json',path], { windowsHide: true })
    let output = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('Video inspection timed out.')) }, 20000)
    child.stdout.on('data', chunk => { output += chunk; if(output.length > 1000000) child.kill() })
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('close', code => {
      clearTimeout(timer)
      try {
        const data = JSON.parse(output)
        const stream = data.streams?.find((s: { codec_type: string }) => s.codec_type === 'video')
        const [n,d] = String(stream?.avg_frame_rate || '0/1').split('/').map(Number)
        const duration = Number(data.format?.duration)
        if(code !== 0 || !stream || !Number.isFinite(duration) || duration <= 0) throw new Error()
        resolve({ duration, fps: n / d || 30 })
      } catch { reject(new Error('This video could not be inspected.')) }
    })
  })
}

async function probeWithFfmpeg(executable: string, path: string): Promise<{ duration: number; fps: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-hide_banner','-i',path], { windowsHide: true })
    let diagnostic = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('Video inspection timed out.')) }, 20000)
    child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-100000) })
    child.on('error', () => { clearTimeout(timer); reject(new Error('FFmpeg is unavailable. Install FFmpeg or set FFMPEG_PATH.')) })
    child.on('close', () => {
      clearTimeout(timer)
      const durationMatch = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i.exec(diagnostic)
      const videoLine = diagnostic.split(/\r?\n/).find(line => /\bVideo:/i.test(line)) || ''
      const fpsMatch = /,\s*(\d+(?:\.\d+)?)\s*fps\b/i.exec(videoLine) || /,\s*(\d+(?:\.\d+)?)\s*tbr\b/i.exec(videoLine)
      if (!durationMatch || !videoLine) { reject(new Error('This video could not be inspected.')); return }
      const duration = Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
      const fps = Number(fpsMatch?.[1]) || 30
      if (!Number.isFinite(duration) || duration <= 0) { reject(new Error('This video could not be inspected.')); return }
      resolve({ duration, fps })
    })
  })
}

export async function probeMedia(executable: string, path: string): Promise<{ duration: number; fps: number }> {
  const probe = executable === 'ffmpeg' ? 'ffprobe' : join(dirname(executable), 'ffprobe.exe')
  try { return await probeWithFfprobe(probe, path) }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return probeWithFfmpeg(executable, path)
    throw error
  }
}
export function exportArguments(input: string, output: string, o: ExportOptions, sourceFps: number) {
  const x = Math.max(0,Math.min(1,o.cropX)), y = Math.max(0,Math.min(1,o.cropY))
  const zoom = o.zoom ?? 1, keyframes = o.keyframes || []
  if (![x,y].every(Number.isFinite) || !Number.isFinite(zoom) || zoom < 1 || zoom > 3 || keyframes.length > 1000 || keyframes.some(frame => ![frame.time,frame.cropX,frame.cropY,frame.zoom].every(Number.isFinite) || frame.time < 0 || frame.time > 86400 || frame.cropX < 0 || frame.cropX > 1 || frame.cropY < 0 || frame.cropY > 1 || frame.zoom < 1 || frame.zoom > 3)) throw new Error('Framing keyframes are invalid.')
  const sortedFrames = keyframes.slice().sort((a,b)=>a.time-b.time)
  if (sortedFrames.some((frame,index)=>index>0&&frame.time-sortedFrames[index-1].time<.06)) throw new Error('Framing keyframes are too close together.')
  const interpolate = (time:number,field:'cropX'|'cropY'|'zoom')=>{
    if(!sortedFrames.length)return field==='cropX'?x:field==='cropY'?y:zoom
    if(time<=sortedFrames[0].time)return sortedFrames[0][field]
    if(time>=sortedFrames[sortedFrames.length-1].time)return sortedFrames[sortedFrames.length-1][field]
    const rightIndex=sortedFrames.findIndex(frame=>frame.time>=time),left=sortedFrames[rightIndex-1],right=sortedFrames[rightIndex]
    const progress=(time-left.time)/(right.time-left.time)
    return left[field]+(right[field]-left[field])*progress
  }
  const expression=(field:'cropX'|'cropY'|'zoom')=>{
    if(!sortedFrames.length)return String(field==='cropX'?x:field==='cropY'?y:zoom)
    const points=[{time:o.start,value:interpolate(o.start,field)},...sortedFrames.filter(frame=>frame.time>o.start+.001&&frame.time<o.end-.001).map(frame=>({time:frame.time,value:frame[field]})),{time:o.end,value:interpolate(o.end,field)}]
    const segments=points.slice(0,-1).map((left,index)=>({left:{time:left.time-o.start,value:left.value},right:{time:points[index+1].time-o.start,value:points[index+1].value}}))
    const render=(range:typeof segments):string=>{
      if(range.length===1){const {left,right}=range[0],delta=right.value-left.value,duration=right.time-left.time;return Math.abs(delta)<1e-12?String(left.value):`${left.value}+(${delta})*(t-${left.time.toFixed(4)})/${duration.toFixed(4)}`}
      const split=Math.floor(range.length/2),at=range[split].left.time
      return `if(lt(t,${at.toFixed(4)}),${render(range.slice(0,split))},${render(range.slice(split))})`
    }
    return `if(lt(t,${segments[0].left.time.toFixed(4)}),${segments[0].left.value},if(lt(t,${segments.at(-1)!.right.time.toFixed(4)}),${render(segments)},${segments.at(-1)!.right.value}))`
  }
  const cropZoom=expression('zoom'),cropX=expression('cropX'),cropY=expression('cropY')
  const fps = Math.min(o.fps,sourceFps)
  const baseFilter = `crop=w='trunc(min(iw,ih*9/16)/(${cropZoom})/2)*2':h='trunc(min(ih,iw*16/9)/(${cropZoom})/2)*2':x='(iw-ow)*(${cropX})':y='(ih-oh)*(${cropY})',scale=1080:1920:flags=lanczos,setsar=1`
  const cam: FaceCamSettings = o.faceCam || { enabled: false, x: .68, y: .62, width: .24, height: .28, size: .3, placement: 'bottom', positionX: .5, positionY: .88 }
  const validCam = typeof cam.enabled === 'boolean' && [cam.x,cam.y,cam.width,cam.height,cam.size,cam.positionX,cam.positionY].every(Number.isFinite) && cam.x >= 0 && cam.y >= 0 && cam.width >= .02 && cam.height >= .02 && cam.x + cam.width <= 1 && cam.y + cam.height <= 1 && cam.size >= .1 && cam.size <= .6 && ['top','bottom','custom'].includes(cam.placement) && cam.positionX >= 0 && cam.positionX <= 1 && cam.positionY >= 0 && cam.positionY <= 1
  if (!validCam) throw new Error('Face camera settings are invalid.')
  const filterArgs = cam.enabled
    ? ['-filter_complex', `[0:v]split=2[main][camera];[main]${baseFilter},fps=${fps}[base];[camera]crop=w='iw*${cam.width}':h='ih*${cam.height}':x='iw*${cam.x}':y='ih*${cam.y}',scale=w='1080*${cam.size}':h='1920*${cam.size}':force_original_aspect_ratio=decrease:flags=lanczos,setsar=1[cam];[base][cam]overlay=x='(W-w)*${cam.positionX}':y='(H-h)*${cam.positionY}',fps=${fps}[vout]`, '-map', '[vout]']
    : ['-vf', `${baseFilter},fps=${fps}`, '-map', '0:v:0']
  return ['-hide_banner','-nostdin','-n','-ss',String(o.start),'-i',input,'-t',String(o.end-o.start),...filterArgs,...(o.muted ? ['-an'] : ['-map','0:a:0?','-c:a','aac','-b:a','160k']),'-c:v','libx264','-preset','veryfast','-crf','21','-pix_fmt','yuv420p','-movflags','+faststart','-progress','pipe:1','-nostats',output]
}
const filterScriptOptions = new Map<string,string>()
async function graphFromFileOption(executable:string) {
  const cached=filterScriptOptions.get(executable);if(cached)return cached
  const version=await new Promise<string>(resolve=>{const child=spawn(executable,['-version'],{windowsHide:true});let output='';child.stdout.on('data',chunk=>{output=(output+chunk.toString()).slice(0,2000)});child.stderr.on('data',chunk=>{output=(output+chunk.toString()).slice(0,2000)});child.on('error',()=>resolve(''));child.on('close',()=>resolve(output))})
  const major=Number(/ffmpeg version\s+(\d+)/i.exec(version)?.[1])
  const option=major>=9?'-/filter_complex':'-filter_complex_script'
  filterScriptOptions.set(executable,option);return option
}
export async function prepareFilterScript(executable:string,args:string[],scriptPath:string) {
  const simpleIndex=args.indexOf('-vf'),complexIndex=args.indexOf('-filter_complex'),index=simpleIndex>=0?simpleIndex:complexIndex
  if(index<0||args[index+1].length<12000)return {args,scriptPath:undefined as string|undefined}
  let graph=args[index+1]
  if(simpleIndex>=0){graph=`[0:v:0]${graph}[vout]`;const map=args.indexOf('-map');if(map>=0)args[map+1]='[vout]';else args.splice(index,2,'-map','[vout]')}
  await writeFile(scriptPath,graph,'utf8')
  args.splice(index,2,await graphFromFileOption(executable),scriptPath)
  return {args,scriptPath}
}
export async function availablePath(path: string) {
  const extension = extname(path) || '.mp4'
  const stem = path.slice(0, path.length - extname(path).length)
  let candidate = path
  for(let n=1;n<10000;n++) {
    try { await access(candidate); candidate = `${stem} (${n})${extension}` }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return candidate; throw error }
  }
  throw new Error('Could not find a free output filename.')
}
export class ExportRunner {
  job: ExportJob | null = null
  private child: ChildProcess | null = null
  private cancelled = false
  async start(input: string, destination: string, o: ExportOptions) {
    if(this.job?.status === 'running') throw new Error('An export is already running.')
    if(![o.start,o.end,o.cropX,o.cropY].every(Number.isFinite) || o.start<0 || o.end<=o.start || o.end-o.start>300 || ![30,60].includes(o.fps) || typeof o.muted !== 'boolean') throw new Error('Choose a valid clip of up to five minutes.')
    const job: ExportJob = { id: randomUUID(), status: 'running', progress: 0 }
    this.job=job; this.cancelled=false
    const temp=join(dirname(destination),`.youcut-${job.id}.mp4`)
    const filterScript=`${temp}.filter`
    void (async()=>{
      try {
        const exe=await findFfmpeg(); const info=await probeMedia(exe,input)
        if(o.end>info.duration+0.1) throw new Error('Clip ends after the source video.')
        if(this.cancelled) { job.status='cancelled'; return }
        const prepared=await prepareFilterScript(exe,exportArguments(input,temp,o,info.fps),filterScript)
        await new Promise<void>((resolve,reject)=>{
          const child=spawn(exe,prepared.args,{windowsHide:true}); this.child=child
          let buffer='',diagnostic=''
          child.stdout.on('data',chunk=>{buffer+=chunk; const lines=buffer.split('\n'); buffer=lines.pop()||''; for(const line of lines) { const match=/^out_time_us=(\d+)/.exec(line); if(match) job.progress=Math.min(0.99,Number(match[1])/1000000/(o.end-o.start)) } })
          child.stderr.on('data',chunk=>{diagnostic=(diagnostic+chunk).slice(-1800)})
          child.on('error',()=>reject(new Error('FFmpeg could not start.')))
          child.on('close',code=>code===0?resolve():reject(new Error(this.cancelled?'Cancelled':`Video export failed. ${diagnostic.slice(-500)}`)))
        })
        this.child=null
        if(this.cancelled) { job.status='cancelled'; return }
        let final=await availablePath(destination)
        for(let attempt=0;;attempt++) {
          try { await copyFile(temp,final,constants.COPYFILE_EXCL); break }
          catch(error) { if((error as NodeJS.ErrnoException).code!=='EEXIST'||attempt>10) throw error; final=await availablePath(destination) }
        }
        job.path=final; job.progress=1; job.status='complete'
      } catch(error) { job.status=this.cancelled?'cancelled':'error'; if(!this.cancelled) job.error=error instanceof Error?error.message:'Export failed.' }
      finally { this.child=null; await Promise.all([rm(temp,{force:true}),rm(filterScript,{force:true})]).catch(()=>{}) }
    })()
    return {...job}
  }
  cancel() { if(this.job?.status==='running') { this.cancelled=true; this.child?.kill() } }
}
