import { app, dialog } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

type SettingsDocument = { backupDirectory?: string; exportDirectory?: string; ignoredRecovery?: Record<string, string> }
const settingsFile = () => join(app.getPath('userData'), 'settings.json')
export const defaultBackupDirectory = () => join(app.getPath('documents'), 'YouCut Backups')

function readSettingsSync(): SettingsDocument {
  try { return JSON.parse(readFileSync(settingsFile(), 'utf8')) as SettingsDocument } catch { return {} }
}

export async function getBackupSettings() {
  const configured = readSettingsSync().backupDirectory
  const directory = typeof configured === 'string' && configured.trim() ? configured : defaultBackupDirectory()
  let available = true
  try { await mkdir(directory, { recursive: true }); await accessDirectory(directory) } catch { available = false }
  return { directory, available, isDefault: !configured }
}

async function accessDirectory(path: string) {
  const { access } = await import('node:fs/promises')
  await access(path)
}

export async function chooseBackupDirectory(parent?: Electron.BrowserWindow) {
  const current = await getBackupSettings()
  const options = { title: 'Choose backup folder', defaultPath: current.directory, properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> }
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return null
  const directory = result.filePaths[0]
  await mkdir(directory, { recursive: true })
  await saveBackupDirectory(directory)
  return directory
}

export async function saveBackupDirectory(directory: string) {
  const file = settingsFile(), temp = `${file}.${randomUUID()}.tmp`
  const previous = readSettingsSync()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(temp, JSON.stringify({ ...previous, backupDirectory: directory }, null, 2), 'utf8')
  try { await rename(temp, file) } catch (error) { const fs = await import('node:fs/promises'); await fs.rm(temp, { force: true }); throw error }
}

export function getIgnoredRecoveryTime(projectId: string) {
  const value = readSettingsSync().ignoredRecovery?.[projectId]
  return typeof value === 'string' ? value : undefined
}

export async function markRecoveryHandled(projectId: string, modifiedAt: string) {
  const file = settingsFile(), temp = `${file}.${randomUUID()}.tmp`, previous = readSettingsSync()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(temp, JSON.stringify({ ...previous, ignoredRecovery: { ...previous.ignoredRecovery, [projectId]: modifiedAt } }, null, 2), 'utf8')
  try { await rename(temp, file) } catch (error) { const fs = await import('node:fs/promises'); await fs.rm(temp, { force: true }); throw error }
}

export function getBackupDirectorySync() {
  const configured = readSettingsSync().backupDirectory
  return typeof configured === 'string' && configured.trim() ? configured : defaultBackupDirectory()
}

export function getLastExportDirectorySync() {
  const configured = readSettingsSync().exportDirectory
  return typeof configured === 'string' && configured.trim() ? configured : undefined
}

export async function saveLastExportDirectory(directory: string) {
  const file = settingsFile(), temp = `${file}.${randomUUID()}.tmp`, previous = readSettingsSync()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(temp, JSON.stringify({ ...previous, exportDirectory: directory }, null, 2), 'utf8')
  try { await rename(temp, file) } catch (error) { const fs = await import('node:fs/promises'); await fs.rm(temp, { force: true }); throw error }
}
