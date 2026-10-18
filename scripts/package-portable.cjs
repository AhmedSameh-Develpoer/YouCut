const fs = require('node:fs/promises')
const path = require('node:path')
const { createPackage } = require('@electron/asar')

function isWithin(parent, child) {
  const relative = path.relative(parent, child)
  return relative.length > 0 && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

async function main() {
  const root = path.resolve(__dirname, '..')
  const dist = path.join(root, 'dist')
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
  const destination = path.join(dist, `YouCut-${manifest.version}-portable`)
  const stage = path.join(dist, `.youcut-portable-stage-${manifest.version}`)
  if (!isWithin(dist, destination) || !isWithin(dist, stage)) throw new Error('Portable build paths escaped dist/.')

  await fs.rm(destination, { recursive: true, force: true })
  await fs.rm(stage, { recursive: true, force: true })
  await fs.cp(path.join(root, 'node_modules/electron/dist'), destination, { recursive: true })
  await fs.rename(path.join(destination, 'electron.exe'), path.join(destination, 'YouCut.exe'))
  await fs.mkdir(stage, { recursive: true })
  await Promise.all([
    fs.cp(path.join(root, 'out'), path.join(stage, 'out'), { recursive: true }),
    fs.copyFile(path.join(root, 'package.json'), path.join(stage, 'package.json')),
  ])
  await fs.mkdir(path.join(destination, 'resources'), { recursive: true })
  await createPackage(stage, path.join(destination, 'resources/app.asar'))
  await fs.writeFile(path.join(destination, 'README-PORTABLE.txt'), [
    `YouCut ${manifest.version} — portable review build`,
    '',
    'Run YouCut.exe from this folder. Keep the folder contents together.',
    'Project files, backups, and activity logs are stored in your Windows user profile.',
    'FFmpeg is not included. The app detects common local installations or PATH; set FFMPEG_PATH if needed.',
    'This portable package is unsigned and is not an installer.',
    '',
  ].join('\r\n'), 'utf8')
  await fs.rm(stage, { recursive: true, force: true })
  const executable = await fs.stat(path.join(destination, 'YouCut.exe'))
  const archive = await fs.stat(path.join(destination, 'resources/app.asar'))
  process.stdout.write(JSON.stringify({ version: manifest.version, destination, executableBytes: executable.size, asarBytes: archive.size }) + '\n')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
