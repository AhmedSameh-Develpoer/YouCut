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
  const editorSource = await fs.readFile(path.join(root, 'src/renderer/src/state/editor.ts'), 'utf8')
  const editorOutput = path.join(root, 'dist', 'editor-state.cjs')
  await fs.writeFile(editorOutput, ts.transpileModule(editorSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText)
  const { useEditor } = require(editorOutput)
  useEditor.getState().hydrate({ start: 0, end: 4, cropX: .5, cropY: .5, zoom: 1, keyframes: frames, trackingLosses: [3], muted: false, fps: 30, faceCam: { enabled: false, x: .6, y: .6, width: .2, height: .2, size: .3, placement: 'bottom', positionX: .5, positionY: .8 } })
  const automatic = [{ time: 1, cropX: .2, cropY: .3, zoom: 1.5 }, { time: 2, cropX: .7, cropY: .4, zoom: 1.5 }]
  useEditor.getState().replaceKeyframes(automatic, [1.5])
  useEditor.getState().undoKeyframe()
  if (JSON.stringify(useEditor.getState().keyframes) !== JSON.stringify(frames) || JSON.stringify(useEditor.getState().trackingLosses) !== '[3]') throw new Error('Undo did not restore the framing and tracking-loss state together.')
  useEditor.getState().redoKeyframe()
  useEditor.getState().upsertKeyframe({ time: 1.5, cropX: .45, cropY: .4, zoom: 1.5 })
  if (useEditor.getState().trackingLosses.length) throw new Error('Manual correction did not clear the nearby tracking-loss marker.')
  useEditor.getState().undoKeyframe()
  if (JSON.stringify(useEditor.getState().trackingLosses) !== '[1.5]') throw new Error('Undo did not restore a cleared tracking-loss marker.')
  process.stdout.write(JSON.stringify({ beforeAndAfterHold: true, linearPositionAndZoom: true, staticFallback: true, trackingUndoRedo: true, manualGapCorrection: true }) + '\n')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
