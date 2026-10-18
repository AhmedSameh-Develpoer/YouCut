const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const Module = require('node:module')
const ts = require('typescript')

function run(executable, args, cwd) {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 60000 })
  if (result.status !== 0) throw new Error(`${executable} failed: ${result.stderr || result.error?.message}`)
}

async function main() {
  const root = path.resolve(__dirname, '..')
  const ffmpeg = process.env.FFMPEG_PATH || spawnSync('where.exe', ['ffmpeg'], { encoding: 'utf8' }).stdout.split(/\r?\n/)[0]
  if (!ffmpeg) throw new Error('Install FFmpeg or set FFMPEG_PATH to run the tracking test.')
  const temp = await fs.mkdtemp(path.join(root, 'dist', '.youcut-track-test-'))
  const modulePath = path.join(temp, 'object-tracking.cjs')
  try {
    const source = await fs.readFile(path.join(root, 'src/main/object-tracking.ts'), 'utf8')
    await fs.writeFile(modulePath, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText)
    const originalLoad = Module._load
    Module._load = function (request, parent, isMain) {
      if (parent?.filename === modulePath && request === './video-export') return { findFfmpeg: async () => ffmpeg, probeMedia: async () => ({ duration: 3, fps: 2 }) }
      return originalLoad.call(this, request, parent, isMain)
    }
    try {
      const { ObjectTrackingRunner } = require(modulePath)
      const positions = [50, 70, 90, null, 130, 150]
      for (let index = 0; index < positions.length; index++) {
        const filters = positions[index] === null ? 'null' : `drawbox=x=${positions[index]}:y=60:w=20:h=20:color=white:t=fill,drawbox=x=${positions[index] + 5}:y=65:w=10:h=10:color=black:t=fill`
        run(ffmpeg, ['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=black:s=320x180:r=2:d=1','-vf',filters,'-frames:v','1',path.join(temp, `frame${String(index + 1).padStart(2, '0')}.png`)], temp)
      }
      const input = path.join(temp, 'moving-object.mkv')
      run(ffmpeg, ['-hide_banner','-loglevel','error','-y','-framerate','2','-i',path.join(temp,'frame%02d.png'),'-c:v','ffv1',input], temp)
      const runner = new ObjectTrackingRunner()
      await runner.start(input, { mediaUrl: 'youcut-media://test', start: 0, end: 3, sourceWidth: 320, sourceHeight: 180, region: { x: .15625, y: 1/3, width: .0625, height: 1/9 }, zoom: 1.4 })
      const deadline = Date.now() + 30000
      while (runner.job.status === 'running' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50))
      const job = runner.snapshot()
      if (job.status !== 'complete') throw new Error(job.error || 'Tracking did not finish.')
      if (job.keyframes.length !== 6 || job.lostAt.length !== 1 || Math.abs(job.lostAt[0] - 1.5) > .02) throw new Error(`Tracking gap was not detected correctly: ${JSON.stringify({ points: job.keyframes.length, lostAt: job.lostAt })}`)
      const x = job.keyframes.map(frame => frame.cropX)
      if (!(x[0] < x[1] && x[1] < x[2] && x[2] === x[3] && x[4] > x[3] && x[5] > x[4])) throw new Error(`Tracking did not follow and hold/reacquire the moving target: ${x.join(',')}`)
      const exportModulePath = path.join(temp, 'video-export.cjs')
      const exportSource = await fs.readFile(path.join(root, 'src/main/video-export.ts'), 'utf8')
      await fs.writeFile(exportModulePath, ts.transpileModule(exportSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText)
      const { exportArguments, prepareFilterScript } = require(exportModulePath)
      const longKeyframes = Array.from({ length: 600 }, (_, index) => ({ time: index / 2, cropX: index % 2 ? .8 : .2, cropY: .5, zoom: 1.4 }))
      const output = path.join(temp, 'tracked-long-expression.mp4'), script = path.join(temp, 'long-expression.filter')
      const args = exportArguments(input, output, { start: 0, end: 300, cropX: .5, cropY: .5, zoom: 1, keyframes: longKeyframes, muted: true, fps: 30, faceCam: { enabled: false, x: .6, y: .6, width: .2, height: .2, size: .3, placement: 'bottom', positionX: .5, positionY: .8 } }, 30)
      const prepared = await prepareFilterScript(ffmpeg, args, script)
      if (!prepared.scriptPath || !prepared.args.some(value => value === '-/filter_complex' || value === '-filter_complex_script') || (await fs.stat(script)).size < 12000) throw new Error('Long keyframe exports did not use the filter-graph file fallback.')
      run(ffmpeg, prepared.args, temp)
      run(ffmpeg, ['-hide_banner', '-v', 'error', '-i', output, '-f', 'null', '-'], temp)
      process.stdout.write(JSON.stringify({ movingObjectFollowed: true, lostFrameHeld: true, reacquired: true, samples: job.keyframes.length, lossMarkers: job.lostAt, longKeyframeExportDecoded: true, longKeyframes: longKeyframes.length }) + '\n')
    } finally { Module._load = originalLoad }
  } finally { await fs.rm(temp, { recursive: true, force: true }) }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
