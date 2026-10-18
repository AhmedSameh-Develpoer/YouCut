import { app, BrowserWindow, dialog, ipcMain, protocol } from 'electron'
import { basename, dirname, join } from 'node:path'
import { stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { randomUUID } from 'node:crypto'
import { mediaResponse } from './media-response'
import { PreviewRunner } from './video-preview'
import { ExportRunner, findFfmpeg, probeMedia } from './video-export'
import { SceneAnalysisRunner } from './scene-analysis'
import { ObjectTrackingRunner } from './object-tracking'
import { getActivityReport, getRecentActivity, initializeActivityLog, markCleanExit, recordActivity } from './activity-log'
import { chooseBackupDirectory, getBackupSettings, getLastExportDirectorySync, markRecoveryHandled, saveLastExportDirectory } from './app-settings'
import type { BatchExportRequest, ExportOptions, ProjectCategory, TrackingRequest } from '../shared/contracts'
import { BatchExportRunner } from './batch-export'
import { chooseProjectPath, createProject, flushProject, listProjects, loadProjectRegistry, readProject, registerProjectFile, relinkProject, restoreProjectSnapshot, saveProject, updateProjectCategory } from './projects'
import { LinkImportRunner } from './link-import'
import { validateVideoUrl } from './link-import-utils'
// Keep userData stable between development and packaged builds so Recent projects,
// settings, and diagnostics resolve to the same YouCut folder.
app.setName('YouCut')
const media = new Map<string, string>()
const runner = new ExportRunner()
const batchRunner = new BatchExportRunner(runner)
const previews = new PreviewRunner()
const analysis = new SceneAnalysisRunner()
const tracking = new ObjectTrackingRunner()
const linkImport = new LinkImportRunner()
const originalTokens = new Set<string>()
let quitting = false
let exportDialogOpen = false
protocol.registerSchemesAsPrivileged([{ scheme: 'youcut-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }])
const currentDirectory = fileURLToPath(new URL('.', import.meta.url))
let observedAnalysis = '', observedTracking = '', observedExport = '', observedBatch = '', observedLinkImport = ''

process.on('uncaughtException', error => { recordActivity({ level: 'error', event: 'main-process-uncaught-exception', details: error.message }); process.exit(1) })
process.on('unhandledRejection', reason => { recordActivity({ level: 'error', event: 'main-process-unhandled-rejection', details: reason instanceof Error ? reason.message : String(reason) }); process.exit(1) })

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: '#171615',
    title: 'YouCut',
    webPreferences: {
      preload: join(currentDirectory, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.once('ready-to-show', () => window.show())
  window.webContents.on('render-process-gone', (_event, details) => recordActivity({ level: 'error', event: 'renderer-process-exited', details: details.reason }))
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(currentDirectory, '../renderer/index.html'))
  }

  return window
}

ipcMain.handle('media:pick-video', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Choose a video',
    properties: ['openFile'],
    filters: [{ name: 'Video files', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'wmv', 'flv', 'ts', 'mts', 'm2ts', 'mpeg', 'mpg', '3gp', 'ogv', 'vob', 'asf'] }, { name: 'All files', extensions: ['*'] }],
  })
  if (result.canceled || !result.filePaths[0]) return null

  const path = result.filePaths[0]
  const details = await stat(path)
  const token = randomUUID()
  media.set(token, path)
  originalTokens.add(token)
  return { path, name: basename(path), sizeBytes: details.size, mediaUrl: `youcut-media://${token}/video` }
})

ipcMain.handle('import:link:start', async (_event, rawUrl: string, category: ProjectCategory) => {
  const url = validateVideoUrl(rawUrl)
  if (!['general','gaming','podcast','interview','reaction','education'].includes(category)) throw new Error('Choose a valid project category.')
  const projectName = `${new URL(url).hostname} Project`
  const projectPath = await chooseProjectPath(projectName)
  if (!projectPath) return null
  const projectId = randomUUID()
  const job = linkImport.start({ url, projectPath, projectId, name: projectName, category }, async (sourcePath, id) => {
    const details = await stat(sourcePath)
    const name = basename(sourcePath).replace(/\.[^.]+$/, '') || projectName
    const project = await createProject(projectPath, sourcePath, details.size, details.mtime.toISOString(), name, category, id)
    const token = randomUUID(), source = { path: sourcePath, name: basename(sourcePath), sizeBytes: details.size, mediaUrl: `youcut-media://${token}/video` }
    media.set(token, sourcePath); originalTokens.add(token)
    recordActivity({ level: 'info', event: 'link-video-imported', operationId: id, details: `Project ${id} imported from ${new URL(url).hostname}.` })
    return { project, source }
  })
  recordActivity({ level: 'info', event: 'link-video-import-started', operationId: job.id, details: `Host ${new URL(url).hostname}.` })
  return job
})
ipcMain.handle('import:link:status', () => {
  const job = linkImport.snapshot()
  if (job && job.status !== 'running' && observedLinkImport !== `${job.id}:${job.status}`) {
    observedLinkImport = `${job.id}:${job.status}`
    recordActivity({ level: job.status === 'error' ? 'error' : 'info', event: `link-import-${job.status}`, operationId: job.id, details: job.error })
  }
  return job
})
ipcMain.handle('import:link:cancel', () => linkImport.cancel())

ipcMain.handle('project:create', async (_event, mediaUrl: string, projectName: string, category: ProjectCategory) => {
  const token = new URL(mediaUrl).hostname, sourcePath = media.get(token)
  if (!sourcePath || !originalTokens.has(token)) throw new Error('Choose a local video before creating a project.')
  const details = await stat(sourcePath)
  const filePath = await chooseProjectPath(projectName || basename(sourcePath).replace(/\.[^.]+$/, '') + ' Project')
  if (!filePath) return null
  const project = await createProject(filePath, sourcePath, details.size, details.mtime.toISOString(), projectName || basename(sourcePath).replace(/\.[^.]+$/, ''), category)
  recordActivity({ level: 'info', event: 'project-created', operationId: project.projectId })
  return { project, source: { path: sourcePath, name: basename(sourcePath), sizeBytes: details.size, mediaUrl } }
})
ipcMain.handle('project:list', () => listProjects())
ipcMain.handle('project:category:update', async (_event, projectId: string, category: ProjectCategory) => {
  try {
    const project = await updateProjectCategory(projectId, category)
    recordActivity({ level: 'info', event: 'project-category-updated', operationId: projectId, details: category })
    return project
  } catch (error) {
    recordActivity({ level: 'error', event: 'project-category-update-failed', operationId: projectId, details: error instanceof Error ? error.message : 'Project category could not be updated.' })
    throw error
  }
})
async function openRegisteredProject(event: Electron.IpcMainInvokeEvent, projectId: string) {
  try {
    let { project, projectPath, sourcePath, sourceSize, sourceModified, missingSource, recoveryCandidate } = await readProject(projectId)
    if (recoveryCandidate) {
      const parent = BrowserWindow.fromWebContents(event.sender)
      const hasLastGood = project !== null
      const arabic = app.getLocale().toLowerCase().startsWith('ar')
      const buttons = hasLastGood ? (arabic ? ['استعادة النسخة الأحدث', 'فتح آخر نسخة سليمة'] : ['Restore newer version', 'Open last saved version']) : (arabic ? ['استعادة النسخة المتاحة', 'إلغاء'] : ['Restore available version', 'Cancel'])
      const options = { type: 'warning' as const, title: arabic ? 'تم العثور على نسخة استرداد' : 'Recovery version found', message: arabic ? 'توجد نسخة أحدث من ملف المشروع. هل تريد استعادتها؟' : 'A newer recovery version is available. Would you like to restore it?', detail: recoveryCandidate.kind === 'interrupted-save' ? (arabic ? 'هذه نسخة كتابة مؤقتة اكتمل حفظ بياناتها قبل إغلاق غير متوقع.' : 'This is a complete temporary save found after an unexpected shutdown.') : (arabic ? 'هذه نسخة مشروع احتياطية محفوظة محليًا.' : 'This is a locally saved project backup.'), buttons, defaultId: 0, cancelId: 1 }
      const choice = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
      if (choice.response === 0) {
        project = await restoreProjectSnapshot(projectId, projectPath, recoveryCandidate.project)
        sourcePath = project.source.path
        recordActivity({ level: 'info', event: 'project-recovery-restored', operationId: projectId })
        try { const source = await stat(sourcePath); sourceSize = source.size; sourceModified = source.mtime.toISOString(); missingSource = false }
        catch { sourceSize = project.source.sizeBytes; sourceModified = project.source.modifiedAt; missingSource = true }
      } else {
        await markRecoveryHandled(projectId, recoveryCandidate.project.modifiedAt)
        if (!hasLastGood) throw new Error('PROJECT_RECOVERY_CANCELLED')
      }
    }
    if (!project) throw new Error('PROJECT_RECOVERY_REQUIRED')
    if (missingSource) {
      const parent = BrowserWindow.fromWebContents(event.sender)
      const options = { title: 'Locate the project source video', properties: ['openFile'] as Array<'openFile'>, filters: [{ name: 'Video files', extensions: ['mp4','mov','mkv','webm','avi','m4v','wmv','flv','ts','mts','m2ts','mpeg','mpg','3gp','ogv','vob','asf'] }, { name: 'All files', extensions: ['*'] }] }
      const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
      if (result.canceled || !result.filePaths[0]) throw new Error('SOURCE_RELINK_CANCELLED')
      sourcePath = result.filePaths[0]
      const details = await stat(sourcePath)
      const mediaInfo = await probeMedia(await findFfmpeg(), sourcePath)
      if (mediaInfo.duration + .1 < project.editor.end) throw new Error('SOURCE_DURATION_TOO_SHORT')
      sourceSize = details.size
      sourceModified = details.mtime.toISOString()
      project = await relinkProject(projectId, sourcePath, sourceSize, sourceModified)
      recordActivity({ level: 'info', event: 'project-source-relinked', operationId: projectId })
    }
    recordActivity({ level: 'info', event: 'project-opened', operationId: projectId })
    const token = randomUUID(); media.set(token, sourcePath); originalTokens.add(token)
    return { project, source: { path: sourcePath, name: basename(sourcePath), sizeBytes: sourceSize, mediaUrl: `youcut-media://${token}/video` } }
  } catch (error) { recordActivity({ level: 'error', event: 'project-open-failed', operationId: projectId, details: error instanceof Error ? error.message : 'Project could not be opened.' }); throw error }
}
ipcMain.handle('project:open', openRegisteredProject)
ipcMain.handle('project:open-file', async (event, expectedProjectId?: string) => {
  const parent = BrowserWindow.fromWebContents(event.sender)
  const options = { title: 'Open YouCut project', properties: ['openFile'] as Array<'openFile'>, filters: [{ name: 'YouCut project', extensions: ['youcut'] }] }
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return null
  const projectId = await registerProjectFile(result.filePaths[0], expectedProjectId)
  return openRegisteredProject(event, projectId)
})
ipcMain.handle('project:save', async (_event, projectId: string, editor) => {
  try {
    const result = await saveProject(projectId, editor)
    recordActivity({ level: result.backupWarning ? 'warning' : 'info', event: result.backupWarning ? 'project-backup-unavailable' : 'project-saved', operationId: projectId, details: result.backupWarning })
    return result
  }
  catch (error) { recordActivity({ level: 'error', event: 'project-save-failed', operationId: projectId, details: error instanceof Error ? error.message : 'Project save failed.' }); throw error }
})
ipcMain.on('project:save-before-close', (event, projectId: string, editor) => {
  event.returnValue = flushProject(projectId, editor)
  if (!event.returnValue.saved) recordActivity({ level: 'error', event: 'project-flush-before-close-failed', operationId: projectId })
  else if (!event.returnValue.backupSaved) recordActivity({ level: 'warning', event: 'project-backup-unavailable', operationId: projectId })
})
ipcMain.handle('analysis:start', async (_event, mediaUrl: string, start: number, end: number) => {
  if (tracking.job?.status === 'running' || runner.job?.status === 'running' || batchRunner.job?.status === 'running') throw new Error('Finish the current video task before scene analysis.')
  const token = new URL(mediaUrl).hostname, path = media.get(token)
  if (!path || !originalTokens.has(token)) throw new Error('Choose a local video before analysis.')
  const job = await analysis.start(path, start, end)
  observedAnalysis = ''
  recordActivity({ level: 'info', event: 'scene-analysis-started', operationId: job.id, details: `range=${start}-${end}` })
  return job
})
ipcMain.handle('analysis:status', () => {
  const job = analysis.job
  if (job && job.status !== 'running' && observedAnalysis !== `${job.id}:${job.status}`) {
    observedAnalysis = `${job.id}:${job.status}`
    recordActivity({ level: job.status === 'error' ? 'error' : 'info', event: `scene-analysis-${job.status}`, operationId: job.id, details: job.error })
  }
  return job ? { ...job, sceneChanges: [...job.sceneChanges], suggestions: [...job.suggestions] } : null
})
ipcMain.handle('analysis:cancel', () => analysis.cancel())

ipcMain.handle('tracking:start', async (_event, request: TrackingRequest) => {
  if (analysis.job?.status === 'running' || runner.job?.status === 'running' || batchRunner.job?.status === 'running') throw new Error('Finish the current video task before tracking an object.')
  const token = new URL(request.mediaUrl).hostname, path = media.get(token)
  if (!path || !originalTokens.has(token)) throw new Error('Choose a local video before tracking.')
  const job = await tracking.start(path, request)
  observedTracking = ''
  recordActivity({ level: 'info', event: 'object-tracking-started', operationId: job.id, details: `range=${request.start}-${request.end}` })
  return job
})
ipcMain.handle('tracking:status', () => {
  const job = tracking.snapshot()
  if (job && job.status !== 'running' && observedTracking !== `${job.id}:${job.status}`) {
    observedTracking = `${job.id}:${job.status}`
    recordActivity({ level: job.status === 'error' ? 'error' : job.lostAt.length ? 'warning' : 'info', event: `object-tracking-${job.status}`, operationId: job.id, details: job.status === 'complete' ? `${job.keyframes.length} points; ${job.lostAt.length} missed samples` : job.error })
  }
  return job
})
ipcMain.handle('tracking:cancel', () => tracking.cancel())

ipcMain.handle('export:start', async (event, options: ExportOptions) => {
  if (exportDialogOpen || runner.job?.status === 'running' || batchRunner.job?.status === 'running' || tracking.job?.status === 'running' || analysis.job?.status === 'running') throw new Error('Finish the current video task before exporting.')
  const token = new URL(options.mediaUrl).hostname
  const input = media.get(token)
  if (!input || !originalTokens.has(token)) throw new Error('Select the original video again.')
  exportDialogOpen = true
  try {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const settings = { title: 'Export MP4', defaultPath: join(getLastExportDirectorySync() || app.getPath('videos'), basename(input).replace(/\.[^.]+$/, '') + '-short.mp4'), filters: [{ name: 'MP4', extensions: ['mp4'] }] }
    const result = parent ? await dialog.showSaveDialog(parent, settings) : await dialog.showSaveDialog(settings)
    if (result.canceled || !result.filePath) return null
    const path = result.filePath.toLowerCase().endsWith('.mp4') ? result.filePath : result.filePath + '.mp4'
    try { await saveLastExportDirectory(dirname(path)) } catch { recordActivity({ level: 'warning', event: 'export-location-not-remembered' }) }
    const job = await runner.start(input, path, options)
    observedExport = ''
    recordActivity({ level: 'info', event: 'video-export-started', operationId: job.id, details: `range=${options.start}-${options.end};fps=${options.fps}` })
    return job
  } finally { exportDialogOpen = false }
})
ipcMain.handle('export:batch:start', async (event, request: BatchExportRequest) => {
  if (exportDialogOpen || runner.job?.status === 'running' || batchRunner.job?.status === 'running' || tracking.job?.status === 'running' || analysis.job?.status === 'running') throw new Error('Finish the current video task before exporting.')
  const token = new URL(request.mediaUrl).hostname, input = media.get(token)
  if (!input || !originalTokens.has(token)) throw new Error('Select the original video again.')
  exportDialogOpen = true
  try {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options = { title: 'Choose folder for batch export', defaultPath: getLastExportDirectorySync() || app.getPath('videos'), properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> }
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    const outputDirectory = result.filePaths[0]
    try { await saveLastExportDirectory(outputDirectory) } catch { recordActivity({ level: 'warning', event: 'export-location-not-remembered' }) }
    const job = await batchRunner.start(input, outputDirectory, request)
    recordActivity({ level: 'info', event: 'batch-export-started', operationId: job.id, details: `${job.items.length} clips` })
    return job
  } finally { exportDialogOpen = false }
})
ipcMain.handle('export:batch:status', () => {
  const job = batchRunner.snapshot()
  const failed = job?.items.filter(item => item.status === 'error').length || 0
  const key = job ? `${job.id}:${job.status}:${failed}` : ''
  if (job && job.status !== 'running' && key !== observedBatch) {
    observedBatch = key
    recordActivity({ level: failed ? 'warning' : 'info', event: job.status === 'cancelled' ? 'batch-export-cancelled' : failed ? 'batch-export-finished-with-errors' : 'batch-export-completed', operationId: job.id, details: `${job.items.filter(item => item.status === 'complete').length}/${job.items.length} clips complete; ${failed} failed` })
  }
  return job
})
ipcMain.handle('export:batch:cancel', () => batchRunner.cancel())
ipcMain.handle('export:batch:retry', async (_event, index: number) => {
  const job = await batchRunner.retry(index)
  recordActivity({ level: 'info', event: 'batch-export-item-retried', operationId: job.id, details: `item=${index + 1}` })
  return job
})
ipcMain.handle('export:status', () => {
  const job = runner.job
  if (job && job.status !== 'running' && observedExport !== `${job.id}:${job.status}`) {
    observedExport = `${job.id}:${job.status}`
    recordActivity({ level: job.status === 'error' ? 'error' : 'info', event: `video-export-${job.status}`, operationId: job.id, details: job.status === 'complete' ? 'Output created successfully.' : job.error })
  }
  return job ? { ...job } : null
})
ipcMain.handle('export:cancel', () => runner.cancel())
ipcMain.handle('activity:list', () => getRecentActivity())
ipcMain.handle('activity:renderer-error', (_event, message: string) => {
  recordActivity({ level: 'error', event: 'renderer-error', details: typeof message === 'string' ? message.slice(0, 1200) : 'Unknown renderer error.' })
})
ipcMain.handle('settings:backup:get', () => getBackupSettings())
ipcMain.handle('settings:backup:choose', async event => {
  const parent = BrowserWindow.fromWebContents(event.sender) || undefined
  const path = await chooseBackupDirectory(parent)
  return path ? await getBackupSettings() : null
})
ipcMain.handle('activity:export', async () => {
  const result = await dialog.showSaveDialog({ title: 'Export diagnostic report', defaultPath: join(app.getPath('documents'), 'YouCut-diagnostic-report.json'), filters: [{ name: 'JSON report', extensions: ['json'] }] })
  if (result.canceled || !result.filePath) return false
  const { writeFile } = await import('node:fs/promises')
  await writeFile(result.filePath.toLowerCase().endsWith('.json') ? result.filePath : `${result.filePath}.json`, getActivityReport(), 'utf8')
  recordActivity({ level: 'info', event: 'diagnostic-report-exported' })
  return true
})
ipcMain.handle('preview:start', async (_event, mediaUrl: string) => {
  const token = new URL(mediaUrl).hostname, path = media.get(token)
  if (!path || !originalTokens.has(token)) throw new Error('Select the original video again.')
  return previews.start(path, join(app.getPath('temp'), 'YouCut-previews'))
})
ipcMain.handle('preview:status', (_event, mediaUrl: string) => {
  const path = media.get(new URL(mediaUrl).hostname)
  if (!path || previews.source !== path || !previews.job) return null
  if (previews.job.status === 'complete' && previews.output && !previews.job.mediaUrl) {
    const token = randomUUID()
    media.set(token, previews.output)
    previews.job.mediaUrl = 'youcut-media://' + token + '/video'
  }
  return { ...previews.job }
})
ipcMain.handle('preview:cancel', (_event, mediaUrl: string) => {
  if (media.get(new URL(mediaUrl).hostname) === previews.source) previews.cancel()
})
app.on('before-quit', () => { runner.cancel(); batchRunner.cancel(); previews.cancel(); analysis.cancel(); tracking.cancel(); linkImport.cancel() })
app.on('will-quit', event => {
  if (quitting) { markCleanExit(); return }
  event.preventDefault()
  void previews.dispose().finally(() => { quitting = true; app.quit() })
})

ipcMain.handle('app:get-info', () => ({
  version: app.getVersion(),
  language: app.getLocale().toLowerCase().startsWith('ar') ? 'ar' : 'en',
}))

app.whenReady().then(async () => {
  initializeActivityLog()
  await loadProjectRegistry()
  protocol.handle('youcut-media', async request => {
    const path = media.get(new URL(request.url).hostname)
    if (!path) return new Response('Not found', { status: 404 })
    try { return await mediaResponse(path, request.headers.get('range'), request.method) }
    catch { return new Response('Source file unavailable', { status: 404 }) }
  })
  app.setAppUserModelId('com.youcut.desktop')
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
