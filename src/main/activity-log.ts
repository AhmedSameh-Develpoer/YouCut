import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type ActivityEntry = { at: string; level: 'info' | 'warning' | 'error'; event: string; operationId?: string; details?: string }
const directory = () => join(app.getPath('userData'), 'logs')
const file = () => join(directory(), 'activity.jsonl')
const cleanMarker = () => join(directory(), 'clean-exit')
const limit = 2 * 1024 * 1024
const redact = (value: string) => value.replace(/\b[A-Za-z]:\\[^\s"']+/g, '[local path]').replace(/https?:\/\/[^\s"']+/gi, '[video link]')

export function recordActivity(entry: Omit<ActivityEntry, 'at'>) {
  try {
    mkdirSync(directory(), { recursive: true })
    if (existsSync(file()) && statSync(file()).size > limit) {
      for (let index = 3; index >= 1; index--) {
        const from = index === 1 ? file() : `${file()}.${index - 1}`
        const to = `${file()}.${index}`
        if (!existsSync(from)) continue
        try { rmSync(to, { force: true }) } catch { /* keep app running */ }
        try { renameSync(from, to) } catch { /* best effort rotation */ }
      }
    }
    appendFileSync(file(), JSON.stringify({ at: new Date().toISOString(), ...entry, details: entry.details ? redact(entry.details) : undefined }) + '\n', 'utf8')
  } catch { /* diagnostics must never interrupt editing or exporting */ }
}

export function initializeActivityLog() {
  mkdirSync(directory(), { recursive: true })
  const hadPreviousRun = existsSync(file()) && statSync(file()).size > 0
  if (hadPreviousRun && !existsSync(cleanMarker())) recordActivity({ level: 'warning', event: 'previous-session-ended-unexpectedly', details: 'The previous app session did not write a clean-exit marker.' })
  try { rmSync(cleanMarker(), { force: true }) } catch { /* best effort */ }
  recordActivity({ level: 'info', event: 'application-started', details: `YouCut ${app.getVersion()}` })
}

export function markCleanExit() {
  recordActivity({ level: 'info', event: 'application-closed' })
  try { writeFileSync(cleanMarker(), new Date().toISOString(), 'utf8') } catch { /* best effort */ }
}

export function getRecentActivity(count = 100): ActivityEntry[] {
  try {
    if (!existsSync(file())) return []
    return readFileSync(file(), 'utf8').split(/\r?\n/).filter(Boolean).slice(-Math.max(1, Math.min(250, count))).flatMap(line => {
      try {
        const value = JSON.parse(line) as ActivityEntry
        if (typeof value.at !== 'string' || typeof value.event !== 'string' || !['info', 'warning', 'error'].includes(value.level)) return []
        return [value]
      } catch { return [] }
    }).reverse()
  } catch { return [] }
}

export function getActivityReport() {
  return JSON.stringify({ application: 'YouCut', version: app.getVersion(), generatedAt: new Date().toISOString(), events: getRecentActivity(250) }, null, 2)
}
