const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const Module = require('node:module')
const { spawn } = require('node:child_process')
const ts = require('typescript')

const sampleUrl = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'

async function compile(source, destination) {
  const text = await fs.readFile(source, 'utf8')
  const output = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  await fs.writeFile(destination, output)
}

function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true })
    let error = ''
    child.stderr.on('data', chunk => { error = (error + chunk).slice(-2000) })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve() : reject(new Error(error || `Process exited with ${code}.`)))
  })
}

async function main() {
  const root = path.resolve(__dirname, '..')
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'youcut-link-e2e-'))
  const modules = path.join(temp, 'modules')
  const projectPath = path.join(temp, 'Link sample.youcut')
  await fs.mkdir(modules, { recursive: true })
  await fs.writeFile(path.join(modules, 'package.json'), '{"type":"commonjs"}')
  const electronStub = { app: { isPackaged: false, getPath: name => name === 'userData' ? temp : temp } }
  const originalLoad = Module._load
  try {
    await Promise.all([
      compile(path.join(root, 'src/main/link-import.ts'), path.join(modules, 'link-import.js')),
      compile(path.join(root, 'src/main/link-import-utils.ts'), path.join(modules, 'link-import-utils.js')),
      compile(path.join(root, 'src/main/video-export.ts'), path.join(modules, 'video-export.js')),
    ])
    Module._load = function (request, parent, isMain) {
      if (request === 'electron') return electronStub
      return originalLoad.call(this, request, parent, isMain)
    }
    process.env.YT_DLP_PATH = path.join(root, 'build', 'vendor', 'yt-dlp.exe')
    const { LinkImportRunner } = require(path.join(modules, 'link-import.js'))
    const runner = new LinkImportRunner()
    let sawDownloadStage = false
    const started = runner.start({ url: sampleUrl, projectPath, projectId: 'link-e2e', name: 'MDN sample', category: 'general' }, async (sourcePath, projectId) => {
      const details = await fs.stat(sourcePath)
      return { project: { projectId, name: 'MDN sample' }, source: { path: sourcePath, name: path.basename(sourcePath), sizeBytes: details.size, mediaUrl: 'youcut-media://test/video' } }
    })
    const deadline = Date.now() + 180_000
    let job
    while (Date.now() < deadline) {
      job = runner.snapshot()
      if (job.stage === 'downloading') sawDownloadStage = true
      if (job.status !== 'running') break
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    if (!job || job.status !== 'complete' || !job.opened) throw new Error(`Link import failed: ${job?.error || job?.message || 'timeout'}`)
    const sourcePath = job.opened.source.path
    if (!sourcePath.startsWith(path.join(temp, 'link-e2e.youcut-data', 'downloads') + path.sep)) throw new Error('Downloaded source was saved outside the project data folder.')
    const details = await fs.stat(sourcePath)
    if (details.size < 1024) throw new Error('Downloaded source file is unexpectedly small.')
    const { findFfmpeg } = require(path.join(modules, 'video-export.js'))
    const ffmpeg = await findFfmpeg()
    await run(ffmpeg, ['-v', 'error', '-i', sourcePath, '-f', 'null', '-'])
    if (!sawDownloadStage) throw new Error('The user-visible download state was never reached.')
    process.stdout.write(JSON.stringify({ checkedPublicLink: true, downloadedToProjectData: true, downloadStageObserved: true, ffmpegDecodePassed: true, bytes: details.size }) + '\n')
    void started
  } finally {
    Module._load = originalLoad
    delete process.env.YT_DLP_PATH
    await fs.rm(temp, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
