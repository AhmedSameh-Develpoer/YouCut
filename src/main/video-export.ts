import { spawn, type ChildProcess } from 'node:child_process'
import { access, readdir, copyFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, dirname, basename, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import type { ExportOptions, ExportJob, FaceCamSettings } from '../shared/contracts'

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
  const fps = Math.min(o.fps,sourceFps)
  const baseFilter = `crop=w='trunc(min(iw,ih*9/16)/2)*2':h='trunc(min(ih,iw*16/9)/2)*2':x='(iw-ow)*${x}':y='(ih-oh)*${y}',scale=1080:1920:flags=lanczos,setsar=1`
  const cam: FaceCamSettings = o.faceCam || { enabled: false, x: .68, y: .62, width: .24, height: .28, size: .3, placement: 'bottom', positionX: .5, positionY: .88 }
  const validCam = typeof cam.enabled === 'boolean' && [cam.x,cam.y,cam.width,cam.height,cam.size,cam.positionX,cam.positionY].every(Number.isFinite) && cam.x >= 0 && cam.y >= 0 && cam.width >= .02 && cam.height >= .02 && cam.x + cam.width <= 1 && cam.y + cam.height <= 1 && cam.size >= .1 && cam.size <= .6 && ['top','bottom','custom'].includes(cam.placement) && cam.positionX >= 0 && cam.positionX <= 1 && cam.positionY >= 0 && cam.positionY <= 1
  if (!validCam) throw new Error('Face camera settings are invalid.')
  const filterArgs = cam.enabled
    ? ['-filter_complex', `[0:v]split=2[main][camera];[main]${baseFilter},fps=${fps}[base];[camera]crop=w='iw*${cam.width}':h='ih*${cam.height}':x='iw*${cam.x}':y='ih*${cam.y}',scale=w='1080*${cam.size}':h='1920*${cam.size}':force_original_aspect_ratio=decrease:flags=lanczos,setsar=1[cam];[base][cam]overlay=x='(W-w)*${cam.positionX}':y='(H-h)*${cam.positionY}',fps=${fps}[vout]`, '-map', '[vout]']
    : ['-vf', `${baseFilter},fps=${fps}`, '-map', '0:v:0']
  return ['-hide_banner','-nostdin','-n','-ss',String(o.start),'-i',input,'-t',String(o.end-o.start),...filterArgs,...(o.muted ? ['-an'] : ['-map','0:a:0?','-c:a','aac','-b:a','160k']),'-c:v','libx264','-preset','veryfast','-crf','21','-pix_fmt','yuv420p','-movflags','+faststart','-progress','pipe:1','-nostats',output]
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
    void (async()=>{
      try {
        const exe=await findFfmpeg(); const info=await probeMedia(exe,input)
        if(o.end>info.duration+0.1) throw new Error('Clip ends after the source video.')
        if(this.cancelled) { job.status='cancelled'; return }
        await new Promise<void>((resolve,reject)=>{
          const child=spawn(exe,exportArguments(input,temp,o,info.fps),{windowsHide:true}); this.child=child
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
      finally { this.child=null; await rm(temp,{force:true}).catch(()=>{}) }
    })()
    return {...job}
  }
  cancel() { if(this.job?.status==='running') { this.cancelled=true; this.child?.kill() } }
}
