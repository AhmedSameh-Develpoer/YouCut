import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FramingKeyframe, TrackingJob, TrackingRequest } from '../shared/contracts'
import { findFfmpeg, probeMedia } from './video-export'

const sampleFps = 2
const analysisWidth = 640

function parseMatches(text: string) {
  const matches = new Map<number, { x: number; y: number; width: number; height: number; score: number }>()
  for (const block of text.split(/(?=frame:\s*\d+)/)) {
    const time = Number(/pts_time:\s*(-?\d+(?:\.\d+)?)/.exec(block)?.[1])
    const x = Number(/lavfi\.rect\.x=(\d+)/.exec(block)?.[1])
    const y = Number(/lavfi\.rect\.y=(\d+)/.exec(block)?.[1])
    const width = Number(/lavfi\.rect\.w=(\d+)/.exec(block)?.[1])
    const height = Number(/lavfi\.rect\.h=(\d+)/.exec(block)?.[1])
    const score = Number(/lavfi\.rect\.score=([\d.]+)/.exec(block)?.[1])
    if ([time, x, y, width, height, score].every(Number.isFinite) && time >= 0 && width > 0 && height > 0) matches.set(Math.round(time * sampleFps), { x, y, width, height, score })
  }
  return matches
}

function run(executable: string, args: string[], cwd: string, onProgress?: (value: number) => void, duration = 1, onSpawn?: (child: ChildProcess) => void) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, cwd })
    onSpawn?.(child)
    let progressText = '', diagnostic = ''
    child.stdout.on('data', chunk => {
      progressText += chunk.toString()
      const lines = progressText.split('\n'); progressText = lines.pop() || ''
      for (const line of lines) {
        const match = /^out_time_us=(\d+)/.exec(line)
        if (match) onProgress?.(Math.min(.98, Number(match[1]) / 1_000_000 / duration))
      }
    })
    child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-2000) })
    child.on('error', () => reject(new Error('FFmpeg could not start. Install FFmpeg or set FFMPEG_PATH.')))
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`Object tracking failed. ${diagnostic.slice(-500)}`)))
  })
}

export class ObjectTrackingRunner {
  job: TrackingJob | null = null
  private child: ChildProcess | null = null
  private cancelled = false

  async start(input: string, request: TrackingRequest) {
    if (this.job?.status === 'running') throw new Error('Tracking is already running.')
    const { start, end, region, sourceWidth, sourceHeight, zoom } = request
    if (![start, end, sourceWidth, sourceHeight, zoom, region.x, region.y, region.width, region.height].every(Number.isFinite) || start < 0 || end <= start || end - start > 300 || sourceWidth < 16 || sourceHeight < 16 || zoom < 1 || zoom > 3 || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 || region.x + region.width > 1 || region.y + region.height > 1) throw new Error('Choose a valid object region and a tracking range up to five minutes.')
    const job: TrackingJob = { id: randomUUID(), status: 'running', progress: 0, keyframes: [], lostAt: [] }
    this.job = job; this.cancelled = false
    void (async () => {
      let workDirectory: string | undefined
      try {
        const executable = await findFfmpeg(), info = await probeMedia(executable, input)
        if (this.cancelled) { job.status = 'cancelled'; return }
        if (end > info.duration + .1) throw new Error('Tracking range ends after the source video.')
        const scaledHeight = Math.max(2, Math.round(sourceHeight * analysisWidth / sourceWidth / 2) * 2)
        const x = Math.max(0, Math.min(analysisWidth - 16, Math.floor(region.x * analysisWidth / 2) * 2))
        const y = Math.max(0, Math.min(scaledHeight - 16, Math.floor(region.y * scaledHeight / 2) * 2))
        const width = Math.min(analysisWidth - x, Math.max(16, Math.floor(region.width * analysisWidth / 2) * 2))
        const height = Math.min(scaledHeight - y, Math.max(16, Math.floor(region.height * scaledHeight / 2) * 2))
        if (region.width * analysisWidth < 16 || region.height * scaledHeight < 16) throw new Error('Make the tracking box at least 16 pixels wide and high.')
        const baseCropWidth = Math.min(1, (9 / 16) / (sourceWidth / sourceHeight))
        const trackZoom = Math.max(1, Math.min(3, Math.max(zoom, .22 * baseCropWidth / region.width)))
        workDirectory = await mkdtemp(join(tmpdir(), 'youcut-track-'))
        const template = join(workDirectory, 'template.pgm')
        await run(executable, ['-hide_banner','-nostdin','-y','-ss',String(start),'-i',input,'-frames:v','1','-vf',`scale=${analysisWidth}:${scaledHeight}:flags=bilinear,crop=${width}:${height}:${x}:${y},format=gray`,template], workDirectory, undefined, 1, child => { this.child = child })
        this.child = null
        if (this.cancelled) { job.status = 'cancelled'; return }
        const metadata = join(workDirectory, 'matches.txt'), duration = end - start
        const filter = `fps=${sampleFps},scale=${analysisWidth}:${scaledHeight}:flags=bilinear,format=gray,find_rect=object=template.pgm:threshold=0.5:mipmaps=3,metadata=mode=print:file=matches.txt`
        await run(executable, ['-hide_banner','-nostdin','-y','-ss',String(start),'-i',input,'-t',String(duration),'-vf',filter,'-an','-progress','pipe:1','-nostats','-f','null','-'], workDirectory, progress => { job.progress = Math.max(.02, progress * .96) }, duration, child => { this.child = child })
        this.child = null
        if (this.cancelled) { job.status = 'cancelled'; return }
        const matches = parseMatches(await readFile(metadata, 'utf8'))
        const count = Math.ceil(duration * sampleFps), fallbackX = region.x + region.width / 2, fallbackY = region.y + region.height / 2
        let lastX = fallbackX, lastY = fallbackY
        const keyframes: FramingKeyframe[] = [], lostAt: number[] = []
        for (let index = 0; index < count; index++) {
          const match = matches.get(index)
          if (match) {
            lastX = Math.max(0, Math.min(1, (match.x + match.width / 2) / analysisWidth))
            lastY = Math.max(0, Math.min(1, (match.y + match.height / 2) / scaledHeight))
          } else lostAt.push(Number((start + index / sampleFps).toFixed(2)))
          keyframes.push({ time: Number((start + index / sampleFps).toFixed(2)), cropX: lastX, cropY: lastY, zoom: trackZoom })
        }
        if (!keyframes.length) throw new Error('No frames were available in the chosen tracking range.')
        job.keyframes = keyframes; job.lostAt = lostAt; job.progress = 1; job.status = 'complete'
      } catch (error) {
        job.status = this.cancelled ? 'cancelled' : 'error'
        if (!this.cancelled) job.error = error instanceof Error ? error.message : 'Object tracking failed.'
      } finally {
        this.child = null
        if (workDirectory) await rm(workDirectory, { recursive: true, force: true }).catch(() => {})
      }
    })()
    return { ...job }
  }

  snapshot() { return this.job ? { ...this.job, keyframes: [...this.job.keyframes], lostAt: [...this.job.lostAt] } : null }
  cancel() { if (this.job?.status === 'running') { this.cancelled = true; this.child?.kill() } }
}
