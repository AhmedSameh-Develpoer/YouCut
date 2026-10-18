const fs = require('node:fs/promises')
const path = require('node:path')
const Module = require('node:module')
const { spawn } = require('node:child_process')
const ts = require('typescript')

function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true })
    let output = ''
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-12000) })
    child.stderr.on('data', chunk => { output = (output + chunk).slice(-12000) })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(`Command exited with ${code}: ${output}`)))
  })
}

async function main() {
  const input = path.resolve(process.argv[2] || '')
  if (!process.argv[2]) throw new Error('Pass a local video path to test.')
  await fs.access(input)
  const root = path.resolve(__dirname, '..')
  const dist = path.join(root, 'dist')
  await fs.mkdir(dist, { recursive: true })
  const temp = await fs.mkdtemp(path.join(dist, '.youcut-source-smoke-'))
  const modulePath = path.join(temp, 'video-export.cjs')
  const source = await fs.readFile(path.join(root, 'src/main/video-export.ts'), 'utf8')
  await fs.writeFile(modulePath, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText)
  const { findFfmpeg, probeMedia, ExportRunner } = require(modulePath)
  const configuredFfmpeg = process.env.FFMPEG_PATH
  try {
    const ffmpeg = await findFfmpeg()
    if (ffmpeg !== 'ffmpeg') process.env.FFMPEG_PATH = ffmpeg
    const info = await probeMedia(ffmpeg, input)
    const end = Math.min(3, info.duration)
    if (end < 1) throw new Error('The selected source is too short for an export smoke test.')
    const output = path.join(temp, 'YouCut real-source smoke.mp4')
    const runner = new ExportRunner()
    await runner.start(input, output, { mediaUrl: 'youcut-media://smoke/video', start: 0, end, cropX: .5, cropY: .5, zoom: 1, keyframes: [], muted: false, fps: 30, faceCam: { enabled: false, x: .68, y: .62, width: .24, height: .28, size: .3, placement: 'bottom', positionX: .5, positionY: .88 } })
    while (runner.job?.status === 'running') await new Promise(resolve => setTimeout(resolve, 100))
    if (runner.job?.status !== 'complete' || !runner.job.path) throw new Error(`Export failed: ${JSON.stringify(runner.job)}`)
    const metadata = await run(ffmpeg, ['-hide_banner', '-i', runner.job.path]).catch(error => error.message)
    if (!/1080x1920/.test(metadata)) throw new Error('Real-source output was not 1080x1920.')
    await run(ffmpeg, ['-v', 'error', '-i', runner.job.path, '-f', 'null', '-'])
    process.stdout.write(JSON.stringify({ realSourceExport: true, input: path.basename(input), inputDuration: info.duration, inputFps: info.fps, testedSeconds: end, dimensions: '1080x1920', fullDecode: true, outputBytes: (await fs.stat(runner.job.path)).size }) + '\n')
  } finally {
    if (configuredFfmpeg) process.env.FFMPEG_PATH = configuredFfmpeg
    else delete process.env.FFMPEG_PATH
    await fs.rm(temp, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
