const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')

const release = '2026.08.19'
const expectedSha256 = '66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a'
const url = `https://github.com/yt-dlp/yt-dlp/releases/download/${release}/yt-dlp.exe`

async function main() {
  const root = path.resolve(__dirname, '..')
  const directory = path.join(root, 'build', 'vendor')
  const destination = path.join(directory, 'yt-dlp.exe')
  await fs.mkdir(directory, { recursive: true })
  try {
    const cached = await fs.readFile(destination)
    const actualSha256 = crypto.createHash('sha256').update(cached).digest('hex')
    if (actualSha256 === expectedSha256) {
      process.stdout.write(JSON.stringify({ tool: 'yt-dlp', release, bytes: cached.length, sha256: actualSha256, destination, cached: true }) + '\n')
      return
    }
  } catch { /* Fetch the pinned official release when no verified copy is available. */ }
  const response = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'YouCut-builder' } })
  if (!response.ok) throw new Error(`Could not download the official yt-dlp release (${response.status}).`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const actualSha256 = crypto.createHash('sha256').update(bytes).digest('hex')
  if (actualSha256 !== expectedSha256) throw new Error(`yt-dlp SHA-256 mismatch for release ${release}.`)
  const temporary = `${destination}.tmp`
  await fs.writeFile(temporary, bytes, { flag: 'w' })
  await fs.rename(temporary, destination)
  process.stdout.write(JSON.stringify({ tool: 'yt-dlp', release, bytes: bytes.length, sha256: actualSha256, destination }) + '\n')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
