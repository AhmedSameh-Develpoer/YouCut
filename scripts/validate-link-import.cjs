const fs = require('node:fs/promises')
const path = require('node:path')
const ts = require('typescript')

async function main() {
  const root = path.resolve(__dirname, '..')
  const dist = path.join(root, 'dist')
  await fs.mkdir(dist, { recursive: true })
  const output = path.join(dist, 'link-import-utils.cjs')
  const source = await fs.readFile(path.join(root, 'src/main/link-import-utils.ts'), 'utf8')
  await fs.writeFile(output, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText)
  const { validateVideoUrl, progressFromLine, isLiveMetadata } = require(output)
  const valid = validateVideoUrl('https://www.youtube.com/watch?v=example&t=42#details')
  if (valid !== 'https://www.youtube.com/watch?v=example&t=42') throw new Error(`Unexpected link normalization: ${valid}`)
  for (const value of ['file:///C:/video.mp4', 'javascript:alert(1)', 'https://user:pass@example.com/video', 'http://localhost/video', 'http://127.0.0.1/video', 'http://192.168.1.5/video', 'http://[::1]/video']) {
    let rejected = false
    try { validateVideoUrl(value) } catch { rejected = true }
    if (!rejected) throw new Error(`Unsafe video URL was accepted: ${value}`)
  }
  if (progressFromLine('[download]  37.5% of 10.00MiB at 2.00MiB/s ETA 00:04') !== .375) throw new Error('Download progress parsing failed.')
  if (progressFromLine('[download] Destination: file.mp4') !== null) throw new Error('Non-progress output was parsed as progress.')
  if (!isLiveMetadata({ is_live: true }) || !isLiveMetadata({ live_status: 'is_upcoming' }) || isLiveMetadata({ live_status: 'was_live' })) throw new Error('Live-stream filtering failed.')
  process.stdout.write(JSON.stringify({ publicHttpsAccepted: true, unsafeSchemesAndLocalHostsRejected: true, progressParsed: true, liveStreamsRejected: true }) + '\n')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
