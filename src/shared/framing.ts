import type { FramingKeyframe } from './contracts'

export type Framing = Pick<FramingKeyframe, 'cropX' | 'cropY' | 'zoom'>

export function interpolateFraming(time: number, keyframes: FramingKeyframe[], fallback: Framing): Framing {
  const points = keyframes.filter(point => Number.isFinite(point.time)).slice().sort((a, b) => a.time - b.time)
  if (!points.length) return fallback
  if (time <= points[0].time) return { cropX: points[0].cropX, cropY: points[0].cropY, zoom: points[0].zoom }
  const last = points[points.length - 1]
  if (time >= last.time) return { cropX: last.cropX, cropY: last.cropY, zoom: last.zoom }
  const rightIndex = points.findIndex(point => point.time >= time)
  const left = points[rightIndex - 1], right = points[rightIndex]
  const span = right.time - left.time
  if (span <= 0) return { cropX: right.cropX, cropY: right.cropY, zoom: right.zoom }
  const progress = Math.max(0, Math.min(1, (time - left.time) / span))
  return {
    cropX: left.cropX + (right.cropX - left.cropX) * progress,
    cropY: left.cropY + (right.cropY - left.cropY) * progress,
    zoom: left.zoom + (right.zoom - left.zoom) * progress,
  }
}
