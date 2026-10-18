import { contextBridge, ipcRenderer } from 'electron'
import type { YouCutDesktopApi } from '../shared/contracts'

const desktopApi: YouCutDesktopApi = {
  pickVideo: () => ipcRenderer.invoke('media:pick-video'),
  chooseExportLocation: (suggestedName) => ipcRenderer.invoke('export:choose-location', suggestedName),
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
}

contextBridge.exposeInMainWorld('youcut', desktopApi)
