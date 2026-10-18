import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { findFfmpeg, probeMedia } from './video-export'
import type { AnalysisJob, SceneSuggestion } from '../shared/contracts'

function rankScenes(start: number, end: number, changes: number[]): SceneSuggestion[] {
  const length = Math.min(30, end - start)
  if (length < 3) return []
  const candidates: SceneSuggestion[] = []
  for (let at = start; at + length <= end + 0.01; at += Math.max(5, length / 3)) {
    const stop = Math.min(end, at + length)
    const inside = changes.filter(time => time >= at && time <= stop).length
    if (inside === 0) continue
    const score = Math.min(100, Math.round(inside / Math.max(1, length / 10) * 100))
    candidates.push({ id: randomUUID(), start: Number(at.toFixed(2)), end: Number(stop.toFixed(2)), score, reason: `${inside} visual scene change${inside === 1 ? '' : 's'} in ${Math.round(stop - at)} seconds` })
  }
  const picked: SceneSuggestion[] = []
  for (const item of candidates.sort((a, b) => b.score - a.score || a.start - b.start)) {
    if (picked.every(existing => item.end <= existing.start || item.start >= existing.end)) picked.push(item)
    if (picked.length >= 8) break
  }
  return picked.sort((a, b) => a.start - b.start)
}

export class SceneAnalysisRunner {
  job: AnalysisJob | null = null
  private child: ChildProcess | null = null
  private cancelled = false

  async start(input: string, start: number, end: number) {
    if (this.job?.status === 'running') throw new Error('An analysis is already running.')
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end - start > 300) throw new Error('Choose an analysis range of up to five minutes.')
    const job: AnalysisJob = { id: randomUUID(), status: 'running', progress: 0, range: { start, end }, sceneChanges: [], suggestions: [] }
    this.job = job; this.cancelled = false
    void (async () => {
      try {
        const executable = await findFfmpeg(), info = await probeMedia(executable, input)
        if (end > info.duration + .1) throw new Error('Analysis range ends after the source video.')
        if (this.cancelled) { job.status = 'cancelled'; return }
        await new Promise<void>((resolve, reject) => {
          const duration = end - start
          const child = spawn(executable, ['-hide_banner','-nostdin','-ss',String(start),'-i',input,'-t',String(duration),'-vf','scdet=threshold=5,metadata=mode=print','-an','-progress','pipe:1','-nostats','-f','null','-'], { windowsHide: true })
          this.child = child
          let progressText = '', diagnostic = '', stderrBuffer = '', relativeTime = Number.NaN, lastChange = -1
          child.stdout.on('data', chunk => {
            progressText += chunk.toString(); const lines = progressText.split('\n'); progressText = lines.pop() || ''
            for (const line of lines) { const match = /^out_time_us=(\d+)/.exec(line); if (match) job.progress = Math.min(.98, Number(match[1]) / 1000000 / duration) }
          })
          child.stderr.on('data', chunk => {
            const part = chunk.toString(); diagnostic = (diagnostic + part).slice(-1600); stderrBuffer += part
            const lines = stderrBuffer.split('\n'); stderrBuffer = lines.pop() || ''
            for (const line of lines) {
              const timeMatch = /pts_time:\s*(-?\d+(?:\.\d+)?)/.exec(line)
              if (timeMatch) relativeTime = Number(timeMatch[1])
              const scoreMatch = /lavfi\.scd\.score=([\d.]+)/.exec(line)
              const score = scoreMatch ? Number(scoreMatch[1]) : 0
              if (score >= .05 && Number.isFinite(relativeTime) && relativeTime > .1 && relativeTime < duration - .1 && relativeTime - lastChange >= .5) {
                job.sceneChanges.push(Number((start + relativeTime).toFixed(2)))
                lastChange = relativeTime
              }
            }
          })
          child.on('error', () => reject(new Error('FFmpeg could not start. Install FFmpeg or set FFMPEG_PATH.')))
          child.on('close', code => code === 0 ? resolve() : reject(new Error(`Scene analysis failed. ${diagnostic.slice(-500)}`)))
        })
        this.child = null
        if (this.cancelled) { job.status = 'cancelled'; return }
        job.sceneChanges = [...new Set(job.sceneChanges)].sort((a,b)=>a-b)
        job.suggestions = rankScenes(start, end, job.sceneChanges)
        job.progress = 1; job.status = 'complete'
      } catch (error) { job.status = this.cancelled ? 'cancelled' : 'error'; if (!this.cancelled) job.error = error instanceof Error ? error.message : 'Scene analysis failed.' }
      finally { this.child = null }
    })()
    return { ...job }
  }

  cancel() { if (this.job?.status === 'running') { this.cancelled = true; this.child?.kill() } }
}
