const fs = require('node:fs/promises')
const path = require('node:path')
const ts = require('typescript')

async function main() {
  const root = path.resolve(__dirname, '..')
  const output = path.join(root, 'dist', 'framing.cjs')
  await fs.mkdir(path.dirname(output), { recursive: true })
  const source = await fs.readFile(path.join(root, 'src/shared/framing.ts'), 'utf8')
  await fs.writeFile(output, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText)
  const { interpolateFraming } = require(output)
  const fallback = { cropX: 0.5, cropY: 0.5, zoom: 1 }
  const frames = [{ time: 2, cropX: 0.1, cropY: 0.2, zoom: 1.2 }, { time: 8, cropX: 0.9, cropY: 0.8, zoom: 2.4 }]
  const before = interpolateFraming(0, frames, fallback)
  const middle = interpolateFraming(5, frames, fallback)
  const after = interpolateFraming(12, frames, fallback)
  if (JSON.stringify(before) !== JSON.stringify({ cropX: 0.1, cropY: 0.2, zoom: 1.2 })) throw new Error('Framing did not hold the first keyframe before its time.')
  if (Math.abs(middle.cropX - 0.5) > 1e-9 || Math.abs(middle.cropY - 0.5) > 1e-9 || Math.abs(middle.zoom - 1.8) > 1e-9) throw new Error('Framing interpolation between keyframes is not linear.')
  if (JSON.stringify(after) !== JSON.stringify({ cropX: 0.9, cropY: 0.8, zoom: 2.4 })) throw new Error('Framing did not hold the last keyframe after its time.')
  if (JSON.stringify(interpolateFraming(0, [], fallback)) !== JSON.stringify(fallback)) throw new Error('Static framing changed when no keyframes exist.')
  process.stdout.write(JSON.stringify({ beforeAndAfterHold: true, linearPositionAndZoom: true, staticFallback: true }) + '\n')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
