import { basename, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { BatchExportJob, BatchExportRequest, ExportJob, ExportOptions, FaceCamSettings } from '../shared/contracts'
import { ExportRunner } from './video-export'

type ExportDriver = {
  job: ExportJob | null
  start: (input: string, destination: string, options: ExportOptions) => Promise<ExportJob>
  cancel: () => void
}

function cleanName(value: string, fallback: string) {
  const cleaned = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 80)
  return cleaned || fallback
}

function delay(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)) }
function processedCount(job: BatchExportJob) { return job.items.filter(item => item.status === 'complete' || item.status === 'error').length }

export class BatchExportRunner {
  job: BatchExportJob | null = null
  private cancelled = false

  constructor(private readonly exporter: ExportDriver = new ExportRunner()) {}

  async start(input: string, outputDirectory: string, request: BatchExportRequest) {
    if (this.job?.status === 'running') throw new Error('A batch export is already running.')
    if (!input || !outputDirectory || !Array.isArray(request.clips) || request.clips.length < 1 || request.clips.length > 8) throw new Error('Choose between one and eight clips to export.')
    const zoom = request.zoom ?? 1, keyframes = request.keyframes || []
    if (![request.cropX, request.cropY].every(value => Number.isFinite(value) && value >= 0 && value <= 1) || !Number.isFinite(zoom) || zoom < 1 || zoom > 3 || keyframes.length > 1000 || keyframes.some(frame => ![frame.time,frame.cropX,frame.cropY,frame.zoom].every(Number.isFinite) || frame.time < 0 || frame.time > 86400 || frame.cropX < 0 || frame.cropX > 1 || frame.cropY < 0 || frame.cropY > 1 || frame.zoom < 1 || frame.zoom > 3) || typeof request.muted !== 'boolean' || ![30, 60].includes(request.fps)) throw new Error('Export settings are invalid.')
    if (request.clips.some(clip => typeof clip.id !== 'string' || !clip.id.trim()) || new Set(request.clips.map(clip => clip.id)).size !== request.clips.length) throw new Error('Each selected clip must have a unique identifier.')
    for (const clip of request.clips) {
      if (!Number.isFinite(clip.start) || !Number.isFinite(clip.end) || clip.start < 0 || clip.end <= clip.start || clip.end - clip.start > 300 || typeof clip.name !== 'string') throw new Error('A selected clip has invalid timing.')
      if (clip.framing && (![clip.framing.cropX,clip.framing.cropY].every(value=>Number.isFinite(value)&&value>=0&&value<=1) || !Number.isFinite(clip.framing.zoom) || clip.framing.zoom<1 || clip.framing.zoom>3 || !Array.isArray(clip.framing.keyframes) || !Array.isArray(clip.framing.trackingLosses) || !clip.framing.faceCam)) throw new Error('A selected clip has invalid framing settings.')
    }

    this.cancelled = false
    this.job = {
      id: randomUUID(), status: 'running', progress: 0, currentIndex: null, outputDirectory,
      items: request.clips.map((clip, index) => ({ ...clip, name: cleanName(clip.name, `Clip ${index + 1}`), status: 'queued', progress: 0 })),
    }
    void this.run(input, request)
    return this.snapshot()!
  }

  async retry(index: number) {
    if (!this.job || this.job.status === 'running') throw new Error('Wait until the current batch finishes before retrying a clip.')
    if (!Number.isInteger(index) || index < 0 || index >= this.job.items.length || this.job.items[index].status !== 'error') throw new Error('Only a failed clip can be retried.')
    this.job.status = 'running'
    this.cancelled = false
    void this.retryItem(index)
    return this.snapshot()!
  }

  private input: string | null = null
  private request: BatchExportRequest | null = null

  private async retryItem(index: number) {
    const job = this.job
    if (!job || !this.input || !this.request) return
    await this.runItem(index, job.items.length, this.input, this.request)
    job.currentIndex = null
    job.status = this.cancelled ? 'cancelled' : 'complete'
  }

  private async run(input: string, request: BatchExportRequest) {
    this.input = input
    this.request = request
    if (!this.job) return
    for (let index = 0; index < this.job.items.length; index++) {
      if (this.cancelled) {
        for (const item of this.job.items) if (item.status === 'queued') item.status = 'cancelled'
        break
      }
      await this.runItem(index, this.job.items.length, input, request)
    }
    if (this.job) {
      this.job.currentIndex = null
      this.job.status = this.cancelled ? 'cancelled' : 'complete'
      this.job.progress = this.cancelled ? processedCount(this.job) / this.job.items.length : 1
    }
  }

  private async runItem(index: number, total: number, input: string, request: BatchExportRequest) {
    const job = this.job
    if (!job) return
    const item = job.items[index]
    job.currentIndex = index
    item.status = 'running'
    item.progress = 0
    item.error = undefined
    const sourceBase = basename(input, extname(input))
    const outputName = cleanName(`${sourceBase} - ${item.name}`, `Clip ${index + 1}`)
    const destination = join(job.outputDirectory, `${outputName}.mp4`)
    const framing=item.framing
    const options: ExportOptions = { mediaUrl: request.mediaUrl, start: item.start, end: item.end, cropX: framing?.cropX??request.cropX, cropY: framing?.cropY??request.cropY, zoom: framing?.zoom??request.zoom??1, keyframes: framing?.keyframes??request.keyframes??[], muted: request.muted, fps: request.fps, faceCam: framing?.faceCam??request.faceCam??{ enabled: false, x: .68, y: .62, width: .24, height: .28, size: .3, placement: 'bottom', positionX: .5, positionY: .88 } as FaceCamSettings }
    try {
      await this.exporter.start(input, destination, options)
      while (this.exporter.job?.status === 'running') {
        if (this.cancelled) this.exporter.cancel()
        item.progress = this.exporter.job.progress
        job.progress = (processedCount(job) + item.progress) / total
        await delay(120)
      }
      const result = this.exporter.job
      if (!result || result.status === 'error') throw new Error(result?.error || 'Clip export failed.')
      if (result.status === 'cancelled' || this.cancelled) item.status = 'cancelled'
      else { item.status = 'complete'; item.progress = 1; item.path = result.path }
    } catch (error) {
      item.status = this.cancelled ? 'cancelled' : 'error'
      item.error = this.cancelled ? undefined : error instanceof Error ? error.message : 'Clip export failed.'
    }
    job.progress = processedCount(job) / total
    if (this.cancelled) for (const value of job.items) if (value.status === 'queued') value.status = 'cancelled'
  }

  cancel() {
    if (this.job?.status === 'running') { this.cancelled = true; this.exporter.cancel() }
  }

  snapshot() {
    return this.job ? { ...this.job, items: this.job.items.map(item => ({ ...item })) } : null
  }
}
