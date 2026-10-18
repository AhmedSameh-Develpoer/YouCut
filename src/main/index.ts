import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { basename, join } from 'node:path'
import { stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const currentDirectory = fileURLToPath(new URL('.', import.meta.url))

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
    filters: [{ name: 'Video files', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi'] }],
  })
  if (result.canceled || !result.filePaths[0]) return null

  const path = result.filePaths[0]
  const details = await stat(path)
  return { path, name: basename(path), sizeBytes: details.size }
})

ipcMain.handle('export:choose-location', async (_event, suggestedName: unknown) => {
  const safeName = typeof suggestedName === 'string' && suggestedName.trim()
    ? suggestedName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120)
    : 'youcut-short.mp4'
  const result = await dialog.showSaveDialog({
    title: 'Export video',
    defaultPath: join(app.getPath('videos'), safeName.toLowerCase().endsWith('.mp4') ? safeName : `${safeName}.mp4`),
    filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
  })
  if (result.canceled || !result.filePath) return null
  return { path: result.filePath, name: basename(result.filePath) }
})

ipcMain.handle('app:get-info', () => ({
  version: app.getVersion(),
  language: app.getLocale().toLowerCase().startsWith('ar') ? 'ar' : 'en',
}))

app.whenReady().then(() => {
  app.setAppUserModelId('com.youcut.desktop')
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
