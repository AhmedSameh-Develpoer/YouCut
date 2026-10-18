const fs = require('node:fs/promises')
const path = require('node:path')
const Module = require('node:module')
const { spawn } = require('node:child_process')
const ts = require('typescript')

async function compile(source, destination) {
  const text = await fs.readFile(source, 'utf8')
  const output = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  await fs.writeFile(destination, output)
}

function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true })
    let diagnostic = ''
    child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-6000) })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve(diagnostic) : reject(new Error(`Command exited with ${code}: ${diagnostic}`)))
  })
}

async function main() {
  const root = path.resolve(__dirname, '..')
  const dist = path.join(root, 'dist')
  await fs.mkdir(dist, { recursive: true })
  const temp = await fs.mkdtemp(path.join(dist, '.youcut-batch-'))
  const outputDirectory = path.join(temp, 'exports')
  const source = path.join(temp, 'synthetic-4k.mp4')
  const videoModulePath = path.join(temp, 'video-export.cjs')
  const batchModulePath = path.join(temp, 'batch-export.cjs')
  await fs.mkdir(outputDirectory, { recursive: true })
  await compile(path.join(root, 'src/main/video-export.ts'), videoModulePath)
  await compile(path.join(root, 'src/main/batch-export.ts'), batchModulePath)
    const { findFfmpeg, exportArguments } = require(videoModulePath)
  const configuredFfmpeg = process.env.FFMPEG_PATH
  delete process.env.FFMPEG_PATH
  const ffmpeg = await findFfmpeg()
  if (configuredFfmpeg && ffmpeg !== configuredFfmpeg && path.resolve(ffmpeg).toLowerCase() !== path.resolve(configuredFfmpeg).toLowerCase()) throw new Error(`FFmpeg discovery selected ${ffmpeg}, not the configured executable.`)
  if (ffmpeg !== 'ffmpeg') process.env.FFMPEG_PATH = ffmpeg

  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === batchModulePath && request === './video-export') return originalLoad.call(this, videoModulePath, parent, isMain)
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    await run(ffmpeg, ['-hide_banner','-y','-f','lavfi','-i','testsrc2=size=3840x2160:rate=30','-f','lavfi','-i','sine=frequency=880:sample_rate=48000','-t','4','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k',source])
    const { BatchExportRunner } = require(batchModulePath)
    const runner = new BatchExportRunner()
    const framingKeyframes = [
      { time: 0, cropX: 0.15, cropY: 0.3, zoom: 1.1 },
      { time: 1, cropX: 0.35, cropY: 0.45, zoom: 1.5 },
      { time: 1.2, cropX: 0.55, cropY: 0.55, zoom: 1.7 },
      { time: 2.2, cropX: 0.82, cropY: 0.7, zoom: 2.1 },
    ]
    const dynamicArgs = exportArguments(source, path.join(outputDirectory, 'keyframe-probe.mp4'), { mediaUrl: 'youcut-media://test/video', start: 0, end: 2.2, cropX: .5, cropY: .5, zoom: 1, keyframes: framingKeyframes, muted: true, fps: 30, faceCam: { enabled: false, x: .68, y: .62, width: .24, height: .28, size: .3, placement: 'bottom', positionX: .5, positionY: .88 } }, 30)
    const filterIndex = dynamicArgs.indexOf('-vf')
    if (filterIndex < 0 || !dynamicArgs[filterIndex + 1].includes('if(lt(t,') || !dynamicArgs[filterIndex + 1].includes('/(if(lt(t,')) throw new Error('FFmpeg framing expressions did not include interpolated position and zoom.')
    await runner.start(source, outputDirectory, {
      mediaUrl: 'youcut-media://test/video', cropX: 0.5, cropY: 0.5, zoom: 1, keyframes: framingKeyframes, muted: false, fps: 30,
      faceCam: { enabled: true, x: 0.68, y: 0.62, width: 0.24, height: 0.28, size: 0.3, placement: 'bottom', positionX: 0.5, positionY: 0.88 },
      clips: [
        { id: 'one', name: 'Moment One', start: 0, end: 1, framing: { cropX: .04, cropY: .5, zoom: 1, keyframes: [], trackingLosses: [], faceCam: { enabled: false, x: .68, y: .62, width: .24, height: .28, size: .3, placement: 'bottom', positionX: .5, positionY: .88 } } },
        { id: 'two', name: 'Moment: Two', start: 1.2, end: 2.2, framing: { cropX: .96, cropY: .5, zoom: 1.7, keyframes: [], trackingLosses: [], faceCam: { enabled: false, x: .68, y: .62, width: .24, height: .28, size: .3, placement: 'bottom', positionX: .5, positionY: .88 } } },
        { id: 'three', name: 'Moment One', start: 2.4, end: 3.4, framing: { cropX: .5, cropY: .5, zoom: 1, keyframes: [], trackingLosses: [], faceCam: { enabled: false, x: .68, y: .62, width: .24, height: .28, size: .3, placement: 'bottom', positionX: .5, positionY: .88 } } },
      ],
    })
    while (runner.job?.status === 'running') await new Promise(resolve => setTimeout(resolve, 150))
    const job = runner.snapshot()
    if (job?.status !== 'complete' || job.items.some(item => item.status !== 'complete' || !item.path)) throw new Error(`Real batch export failed: ${JSON.stringify(job)}`)
    const batchNames = job.items.map(item => path.basename(item.path))
    if (!batchNames.includes('synthetic-4k - Moment One.mp4') || !batchNames.includes('synthetic-4k - Moment_ Two.mp4') || !batchNames.includes('synthetic-4k - Moment One (2).mp4')) throw new Error(`Clip names were not preserved safely or duplicate names collided: ${batchNames.join(', ')}`)
    for (const item of job.items) {
      if ((await fs.stat(item.path)).size < 1000) throw new Error(`Export is unexpectedly small: ${item.path}`)
      const metadata = await run(ffmpeg, ['-hide_banner','-i',item.path]) .catch(error => error.message)
      if (!/1080x1920/.test(metadata)) throw new Error(`Output is not 1080x1920: ${item.path}`)
      await run(ffmpeg, ['-v','error','-i',item.path,'-f','null','-'])
    }
    const clipFrames = await Promise.all(job.items.map(async (item, index) => {
      const frame = path.join(temp, `clip-${index}.rgb`)
      await run(ffmpeg, ['-v','error','-ss','0.5','-i',item.path,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24',frame])
      return fs.readFile(frame)
    }))
    let clipDifference = 0
    for (let i = 0; i < clipFrames[0].length; i += 97) clipDifference += Math.abs(clipFrames[0][i] - clipFrames[1][i])
    if (clipDifference < 10000) throw new Error('Separate batch clips did not use their own saved framing settings.')
    const staticSource = path.join(temp, 'static-bars.mp4'), animatedOutput = path.join(outputDirectory, 'Animated framing.mp4')
    await run(ffmpeg, ['-hide_banner','-y','-f','lavfi','-i','smptebars=size=3840x2160:rate=30','-t','2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',staticSource])
    await run(ffmpeg, exportArguments(staticSource, animatedOutput, { mediaUrl:'youcut-media://test/video', start:0, end:2, cropX:.5, cropY:.5, zoom:1, keyframes:[{time:0,cropX:.03,cropY:.5,zoom:1},{time:2,cropX:.97,cropY:.5,zoom:1.5}], muted:true, fps:30, faceCam:{enabled:false,x:.68,y:.62,width:.24,height:.28,size:.3,placement:'bottom',positionX:.5,positionY:.88} },30))
    const frameA=path.join(temp,'frame-a.rgb'),frameB=path.join(temp,'frame-b.rgb')
    await run(ffmpeg,['-v','error','-ss','0.2','-i',animatedOutput,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24',frameA])
    await run(ffmpeg,['-v','error','-ss','1.8','-i',animatedOutput,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24',frameB])
    const [pixelsA,pixelsB]=await Promise.all([fs.readFile(frameA),fs.readFile(frameB)])
    let difference=0;for(let i=0;i<pixelsA.length;i+=97)difference+=Math.abs(pixelsA[i]-pixelsB[i])
    if(difference<10000)throw new Error('The exported framing did not visibly move between manual keyframes.')
    await run(ffmpeg,['-v','error','-i',animatedOutput,'-f','null','-'])
    process.stdout.write(JSON.stringify({ realFfmpegBatch: true, clips: job.items.length, dimensions: '1080x1920', fullDecode: true, perClipFraming: true, customNames: true, duplicateNamesAvoidOverwrite: true, perClipSampleDifference: clipDifference, animatedKeyframeCrop: true, sampledFrameDifference: difference, files: batchNames }) + '\n')
  } finally {
    Module._load = originalLoad
    if (configuredFfmpeg) process.env.FFMPEG_PATH = configuredFfmpeg
    else delete process.env.FFMPEG_PATH
    await fs.rm(temp, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
