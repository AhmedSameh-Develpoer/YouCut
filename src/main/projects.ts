import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, parse } from 'node:path'
import { app, dialog } from 'electron'
import type { EditorSettings, FaceCamSettings, ProjectCategory, ProjectDocument, RecentProject } from '../shared/contracts'
import { getBackupDirectorySync, getIgnoredRecoveryTime } from './app-settings'
import { recordActivity } from './activity-log'

const registryFile = () => join(app.getPath('userData'), 'recent-projects.json')
function legacyRegistryFiles() {
  const appData = app.getPath('appData')
  return [join(appData, 'Electron', 'recent-projects.json'), join(appData, 'youcut', 'recent-projects.json')]
    .filter((path, index, paths) => path.toLowerCase() !== registryFile().toLowerCase() && paths.findIndex(value => value.toLowerCase() === path.toLowerCase()) === index)
}
type RecentEntry = { path: string; lastOpenedAt: string; name?: string; category?: ProjectCategory; modifiedAt?: string; sourceName?: string }
let registry: Record<string, RecentEntry> = {}

export async function loadProjectRegistry() {
  const next: Record<string, RecentEntry> = {}
  const locations = [...legacyRegistryFiles(), registryFile()]
  for (const location of locations) {
    let parsed: Record<string, unknown>
    try { parsed = JSON.parse(await readFile(location, 'utf8')) as Record<string, unknown> }
    catch { continue }
    for (const [id, value] of Object.entries(parsed)) {
      const recent: RecentEntry | null = typeof value === 'string'
        ? { path: value, lastOpenedAt: '' }
        : value && typeof value === 'object' && typeof (value as RecentEntry).path === 'string'
          ? { ...(value as RecentEntry), lastOpenedAt: typeof (value as RecentEntry).lastOpenedAt === 'string' ? (value as RecentEntry).lastOpenedAt : '' }
          : null
      if (!recent) continue
      try {
        const project = validateDocument(JSON.parse(await readFile(recent.path, 'utf8')))
        if (project.projectId === id) Object.assign(recent, { name: project.name, category: project.category, modifiedAt: project.modifiedAt, sourceName: basename(project.source.path), lastOpenedAt: recent.lastOpenedAt || project.modifiedAt })
      } catch { /* Keep cached Recent details when the project file is unavailable. */ }
      const previous = next[id]
      if (!previous || (recent.lastOpenedAt || '').localeCompare(previous.lastOpenedAt || '') >= 0) next[id] = recent
    }
  }
  registry = next
  await writeRegistry().catch(() => recordActivity({ level: 'warning', event: 'recent-project-registry-migration-failed' }))
}

async function writeAtomic(path: string, contents: string) {
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, contents, 'utf8')
  try { await rename(temporary, path) }
  catch (error) { await import('node:fs/promises').then(fs => fs.rm(temporary, { force: true })); throw error }
}

async function writeRegistry() {
  await mkdir(dirname(registryFile()), { recursive: true })
  await writeAtomic(registryFile(), JSON.stringify(registry, null, 2))
}

function backupName(project: ProjectDocument) { return `${project.modifiedAt.replace(/[:.]/g, '-')}-${randomUUID()}.youcut` }
function hasBackupSync(project: ProjectDocument) {
  try { return readdirSync(join(getBackupDirectorySync(), project.projectId)).some(name => name.startsWith(project.modifiedAt.replace(/[:.]/g, '-') + '-') && name.endsWith('.youcut')) }
  catch { return false }
}
function pruneBackups(directory: string, projectId: string) {
  const entries = readdirSync(directory).filter(name => name.endsWith('.youcut')).map(name => {
    try {
      const project = validateDocument(JSON.parse(readFileSync(join(directory, name), 'utf8')))
      return project.projectId === projectId ? { name, modifiedAt: project.modifiedAt as string | null } : { name, modifiedAt: null }
    } catch { return { name, modifiedAt: null } }
  })
  const valid = entries.filter((entry): entry is { name: string; modifiedAt: string } => entry.modifiedAt !== null).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
  const keep = new Set(valid.slice(0, 2).map(entry => entry.name))
  for (const entry of entries) if (!entry.modifiedAt || !keep.has(entry.name)) rmSync(join(directory, entry.name), { force: true })
}
async function backupProject(project: ProjectDocument) {
  const directory = join(getBackupDirectorySync(), project.projectId)
  await mkdir(directory, { recursive: true })
  await writeAtomic(join(directory, backupName(project)), JSON.stringify(project, null, 2))
  pruneBackups(directory, project.projectId)
}
function backupProjectSync(project: ProjectDocument) {
  const directory = join(getBackupDirectorySync(), project.projectId)
  mkdirSync(directory, { recursive: true })
  const destination = join(directory, backupName(project)), temporary = `${destination}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify(project, null, 2), 'utf8')
  try { renameSync(temporary, destination) } catch (error) { try { rmSync(temporary, { force: true }) } catch { /* best effort */ }; throw error }
  pruneBackups(directory, project.projectId)
}
async function ensureProjectData(projectPath: string, projectId: string) {
  const directory = join(dirname(projectPath), `${projectId}.youcut-data`)
  await Promise.all([mkdir(join(directory, 'downloads'), { recursive: true }), mkdir(join(directory, 'cache'), { recursive: true })])
}

function validateEditor(value: EditorSettings) {
  if (!value || !Number.isFinite(value.start) || !Number.isFinite(value.end) || value.start < 0 || value.end <= value.start || !Number.isFinite(value.cropX) || value.cropX < 0 || value.cropX > 1 || !Number.isFinite(value.cropY) || value.cropY < 0 || value.cropY > 1 || typeof value.muted !== 'boolean' || ![30, 60].includes(value.fps)) throw new Error('Project editor settings are invalid.')
  const faceCam: FaceCamSettings = value.faceCam || { enabled: false, x: .68, y: .62, width: .24, height: .28, size: .3, placement: 'bottom', positionX: .5, positionY: .88 }
  if (typeof faceCam.enabled !== 'boolean' || ![faceCam.x, faceCam.y, faceCam.width, faceCam.height, faceCam.size, faceCam.positionX, faceCam.positionY].every(Number.isFinite) || faceCam.x < 0 || faceCam.y < 0 || faceCam.width < .02 || faceCam.height < .02 || faceCam.x + faceCam.width > 1 || faceCam.y + faceCam.height > 1 || faceCam.size < .1 || faceCam.size > .6 || !['top','bottom','custom'].includes(faceCam.placement) || faceCam.positionX < 0 || faceCam.positionX > 1 || faceCam.positionY < 0 || faceCam.positionY > 1) throw new Error('Face camera settings are invalid.')
  const zoom = value.zoom ?? 1, keyframes = value.keyframes ?? []
  if (!Number.isFinite(zoom) || zoom < 1 || zoom > 3 || !Array.isArray(keyframes) || keyframes.length > 500 || keyframes.some(frame => !frame || ![frame.time, frame.cropX, frame.cropY, frame.zoom].every(Number.isFinite) || frame.time < 0 || frame.time > 86400 || frame.cropX < 0 || frame.cropX > 1 || frame.cropY < 0 || frame.cropY > 1 || frame.zoom < 1 || frame.zoom > 3)) throw new Error('Framing keyframes are invalid.')
  const sortedKeyframes = keyframes.slice().sort((a, b) => a.time - b.time)
  if (sortedKeyframes.some((frame, index) => index > 0 && frame.time - sortedKeyframes[index - 1].time < .06)) throw new Error('Framing keyframes must be at least 0.06 seconds apart.')
  return { ...value, zoom, keyframes: sortedKeyframes, faceCam }
}

async function register(id: string, path: string, metadata?: Pick<RecentEntry, 'name' | 'category' | 'modifiedAt' | 'sourceName'>, touch = true) {
  const previous = registry[id]
  registry[id] = {
    ...previous,
    ...metadata,
    path,
    lastOpenedAt: touch ? new Date().toISOString() : previous?.lastOpenedAt || metadata?.modifiedAt || new Date().toISOString(),
  }
  await writeRegistry()
}

function validateDocument(value: unknown): ProjectDocument {
  const document = value as ProjectDocument
  if (!document || document.format !== 'youcut-project' || document.schemaVersion !== 1 || typeof document.projectId !== 'string' || typeof document.name !== 'string' || !document.source || document.source.kind !== 'file' || typeof document.source.path !== 'string' || !document.editor || !Number.isFinite(document.editor.start) || !Number.isFinite(document.editor.end) || document.editor.start < 0 || document.editor.end <= document.editor.start || !Number.isFinite(document.editor.cropX) || !Number.isFinite(document.editor.cropY) || typeof document.editor.muted !== 'boolean' || ![30, 60].includes(document.editor.fps)) throw new Error('This YouCut project is invalid or uses an unsupported version.')
  document.editor = validateEditor(document.editor)
  if (!['general','gaming','podcast','interview','reaction','education'].includes(document.category)) document.category = 'general'
  return document
}

export async function listProjects(): Promise<RecentProject[]> {
  const result: RecentProject[] = []
  for (const [projectId, recent] of Object.entries(registry)) {
    try {
      const project = validateDocument(JSON.parse(await readFile(recent.path, 'utf8')))
      if (project.projectId !== projectId) continue
      let sourceAvailable = true
      try { await stat(project.source.path) } catch { sourceAvailable = false }
      const lastOpenedAt = recent.lastOpenedAt || project.modifiedAt
      if (!recent.lastOpenedAt) {
        registry[projectId] = { ...recent, name: project.name, category: project.category, modifiedAt: project.modifiedAt, sourceName: basename(project.source.path), lastOpenedAt }
        await writeRegistry().catch(() => recordActivity({ level: 'warning', event: 'recent-project-touch-failed', operationId: projectId }))
      }
      result.push({ projectId, name: project.name, category: project.category, modifiedAt: project.modifiedAt, lastOpenedAt, sourceName: basename(project.source.path), sourceAvailable, projectAvailable: true })
    } catch {
      if (recent.name) result.push({ projectId, name: recent.name, category: recent.category || 'general', modifiedAt: recent.modifiedAt || recent.lastOpenedAt, lastOpenedAt: recent.lastOpenedAt || recent.modifiedAt || new Date(0).toISOString(), sourceName: recent.sourceName || '', sourceAvailable: false, projectAvailable: false })
    }
  }
  return result.sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))
}

export async function createProject(projectPath: string, sourcePath: string, sourceSize: number, sourceModified: string, name: string, category: ProjectCategory, projectId: string = randomUUID()) {
  const now = new Date().toISOString()
  const document: ProjectDocument = { format: 'youcut-project', schemaVersion: 1, projectId, name, category, createdAt: now, modifiedAt: now, source: { kind: 'file', path: sourcePath, sizeBytes: sourceSize, modifiedAt: sourceModified }, editor: { start: 0, end: 60, cropX: .5, cropY: .5, muted: false, fps: 30, faceCam: { enabled: false, x: .68, y: .62, width: .24, height: .28, size: .3, placement: 'bottom', positionX: .5, positionY: .88 } } }
  const file = projectPath.toLowerCase().endsWith('.youcut') ? projectPath : `${projectPath}.youcut`
  await mkdir(dirname(file), { recursive: true })
  await ensureProjectData(file, document.projectId)
  await writeAtomic(file, JSON.stringify(document, null, 2))
  await register(document.projectId, file, { name: document.name, category: document.category, modifiedAt: document.modifiedAt, sourceName: basename(sourcePath) })
  return document
}

export async function chooseProjectPath(name: string) {
  const result = await dialog.showSaveDialog({ title: 'Create YouCut project', defaultPath: join(app.getPath('documents'), `${parse(name).name || 'Untitled Project'}.youcut`), filters: [{ name: 'YouCut project', extensions: ['youcut'] }] })
  return result.canceled ? null : result.filePath || null
}

export async function registerProjectFile(path: string, expectedProjectId?: string) {
  const project = validateDocument(JSON.parse(await readFile(path, 'utf8')))
  if (expectedProjectId && project.projectId !== expectedProjectId) throw new Error('The selected file is a different YouCut project. Choose the matching project file.')
  const sourceName = basename(project.source.path)
  await register(project.projectId, path, { name: project.name, category: project.category, modifiedAt: project.modifiedAt, sourceName })
  return project.projectId
}

export async function readProject(projectId: string) {
  const path = registry[projectId]?.path
  if (!path) throw new Error('This project is not in the recent projects list. Open or create it again.')
  let project: ProjectDocument
  try { project = validateDocument(JSON.parse(await readFile(path, 'utf8'))) }
  catch (error) {
    const recoveryCandidate = await findRecoveryCandidate(projectId, path)
    if (!recoveryCandidate) throw error
    return { project: null, projectPath: path, sourcePath: recoveryCandidate.project.source.path, sourceSize: recoveryCandidate.project.source.sizeBytes, sourceModified: recoveryCandidate.project.source.modifiedAt, missingSource: true, recoveryCandidate }
  }
  if (project.projectId !== projectId) throw new Error('Project identity check failed.')
  await register(projectId, path, { name: project.name, category: project.category, modifiedAt: project.modifiedAt, sourceName: basename(project.source.path) })
  await ensureProjectData(path, projectId).catch(() => {})
  const recoveryCandidate = await findRecoveryCandidate(projectId, path, project.modifiedAt)
  try {
    const source = await stat(project.source.path)
    return { project, projectPath: path, sourcePath: project.source.path, sourceSize: source.size, sourceModified: source.mtime.toISOString(), missingSource: false, recoveryCandidate }
  } catch {
    return { project, projectPath: path, sourcePath: project.source.path, sourceSize: project.source.sizeBytes, sourceModified: project.source.modifiedAt, missingSource: true, recoveryCandidate }
  }
}

export async function relinkProject(projectId: string, sourcePath: string, sourceSize: number, sourceModified: string) {
  const path = registry[projectId]?.path
  if (!path) throw new Error('The project path is unavailable.')
  const project = validateDocument(JSON.parse(await readFile(path, 'utf8')))
  if (project.projectId !== projectId) throw new Error('Project identity check failed.')
  const updated = validateDocument({ ...project, modifiedAt: new Date().toISOString(), source: { kind: 'file' as const, path: sourcePath, sizeBytes: sourceSize, modifiedAt: sourceModified } })
  await writeAtomic(path, JSON.stringify(updated, null, 2))
  await register(projectId, path, { name: updated.name, category: updated.category, modifiedAt: updated.modifiedAt, sourceName: basename(updated.source.path) })
  try { await backupProject(updated) } catch { recordActivity({ level: 'warning', event: 'project-backup-unavailable', operationId: projectId }) }
  return updated
}

export async function updateProjectCategory(projectId: string, category: ProjectCategory) {
  if (!['general','gaming','podcast','interview','reaction','education'].includes(category)) throw new Error('Choose a supported project category.')
  const path = registry[projectId]?.path
  if (!path) throw new Error('The project path is unavailable.')
  const project = validateDocument(JSON.parse(await readFile(path, 'utf8')))
  if (project.projectId !== projectId) throw new Error('Project identity check failed.')
  const updated = validateDocument({ ...project, category, modifiedAt: new Date().toISOString() })
  await writeAtomic(path, JSON.stringify(updated, null, 2))
  await register(projectId, path, { name: updated.name, category: updated.category, modifiedAt: updated.modifiedAt, sourceName: basename(updated.source.path) })
  try { await backupProject(updated) } catch { recordActivity({ level: 'warning', event: 'project-backup-unavailable', operationId: projectId }) }
  return updated
}

export type ProjectRecoveryCandidate = { project: ProjectDocument; kind: 'backup' | 'interrupted-save'; path: string }
export async function findRecoveryCandidate(projectId: string, projectPath: string, newerThan?: string): Promise<ProjectRecoveryCandidate | null> {
  const candidates: ProjectRecoveryCandidate[] = []
  const cutoff = [newerThan, getIgnoredRecoveryTime(projectId)].filter((value): value is string => Boolean(value)).sort().at(-1)
  const add = async (path: string, kind: ProjectRecoveryCandidate['kind']) => {
    try {
      const project = validateDocument(JSON.parse(await readFile(path, 'utf8')))
      if (project.projectId === projectId && (!cutoff || project.modifiedAt > cutoff)) candidates.push({ project, kind, path })
    } catch { /* Ignore incomplete or unrelated snapshots. */ }
  }
  try {
    const directory = join(getBackupDirectorySync(), projectId)
    for (const name of (await readdir(directory)).filter(name => name.endsWith('.youcut'))) await add(join(directory, name), 'backup')
  } catch { /* Backups may be unavailable when a removable drive is disconnected. */ }
  try {
    const prefix = `${basename(projectPath)}.`
    for (const name of (await readdir(dirname(projectPath))).filter(name => name.startsWith(prefix) && name.endsWith('.tmp'))) await add(join(dirname(projectPath), name), 'interrupted-save')
  } catch { /* The project folder may be unavailable. */ }
  return candidates.sort((a, b) => b.project.modifiedAt.localeCompare(a.project.modifiedAt))[0] || null
}

export async function restoreProjectSnapshot(projectId: string, path: string, candidate: ProjectDocument) {
  const validated = validateDocument(candidate)
  if (validated.projectId !== projectId) throw new Error('Project identity check failed.')
  const recovered = validateDocument({ ...validated, modifiedAt: new Date().toISOString() })
  await writeAtomic(path, JSON.stringify(recovered, null, 2))
  await register(projectId, path, { name: recovered.name, category: recovered.category, modifiedAt: recovered.modifiedAt, sourceName: basename(recovered.source.path) })
  try { await backupProject(recovered) } catch { recordActivity({ level: 'warning', event: 'project-backup-unavailable', operationId: projectId }) }
  return recovered
}

export async function saveProject(projectId: string, editor: EditorSettings) {
  const path = registry[projectId]?.path
  if (!path) throw new Error('The project path is unavailable; use Save As to keep your work.')
  const project = validateDocument(JSON.parse(await readFile(path, 'utf8')))
  const updated = validateDocument({ ...project, modifiedAt: new Date().toISOString(), editor: { ...validateEditor(editor) } })
  await writeAtomic(path, JSON.stringify(updated, null, 2))
  await register(projectId, path, { name: updated.name, category: updated.category, modifiedAt: updated.modifiedAt, sourceName: basename(updated.source.path) })
  let backupWarning: string | undefined
  try { await backupProject(updated) } catch { backupWarning = 'The project was saved, but the backup folder is unavailable.' }
  return { project: updated, backupWarning }
}

export function flushProject(projectId: string, editor: EditorSettings) {
  const path = registry[projectId]?.path
  if (!path) return { saved: false, backupSaved: false }
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const project = validateDocument(JSON.parse(readFileSync(path, 'utf8')))
    const validated = validateEditor(editor)
    if (JSON.stringify(project.editor) === JSON.stringify(validated)) return { saved: true, backupSaved: hasBackupSync(project) }
    const updated = validateDocument({ ...project, modifiedAt: new Date().toISOString(), editor: { ...validated } })
    writeFileSync(temporary, JSON.stringify(updated, null, 2), 'utf8')
    renameSync(temporary, path)
    let backupSaved = false
    try { backupProjectSync(updated); backupSaved = true } catch { /* Main project save remains successful. */ }
    return { saved: true, backupSaved }
  } catch {
    try { rmSync(temporary, { force: true }) } catch { /* Best effort cleanup. */ }
    return { saved: false, backupSaved: false }
  }
}
