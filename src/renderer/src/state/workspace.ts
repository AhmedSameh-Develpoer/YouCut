import { create } from 'zustand'
import type { PickedVideo, SaveLocation, VideoSource } from '../../../shared/contracts'

type Screen = 'projects' | 'import' | 'ready'
type ImportStatus = 'idle' | 'choosing' | 'ready' | 'error'

type WorkspaceState = {
  screen: Screen
  importStatus: ImportStatus
  source: VideoSource | null
  exportLocation: SaveLocation | null
  error: string | null
  language: 'en' | 'ar'
  languageTouched: boolean
  goTo: (screen: Screen) => void
  toggleLanguage: () => void
  setSystemLanguage: (language: 'en' | 'ar') => void
  pickVideo: () => Promise<void>
  setVideoLink: (url: string) => void
  continueToWorkspace: () => void
  chooseExportLocation: () => Promise<void>
  clearSource: () => void
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  screen: 'projects',
  importStatus: 'idle',
  source: null,
  exportLocation: null,
  error: null,
  language: 'en',
  languageTouched: false,
  goTo: (screen) => set({ screen, error: null }),
  toggleLanguage: () => set((state) => ({ language: state.language === 'en' ? 'ar' : 'en', languageTouched: true })),
  setSystemLanguage: (language) => set((state) => state.languageTouched ? {} : { language }),
  pickVideo: async () => {
    set({ importStatus: 'choosing', error: null })
    try {
      const source = await window.youcut.pickVideo()
      if (!source) {
        set({ importStatus: get().source ? 'ready' : 'idle' })
        return
      }
      set({ source: { kind: 'file', ...source }, importStatus: 'ready', screen: 'import', exportLocation: null })
    } catch (error) {
      set({ importStatus: 'error', error: error instanceof Error ? error.message : 'Video could not be opened.' })
    }
  },
  setVideoLink: (url) => {
    const trimmed = url.trim()
    if (!trimmed) {
      set({ source: null, importStatus: 'idle', error: null })
      return
    }
    try {
      const parsed = new URL(trimmed)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid protocol')
      set({ source: { kind: 'link', url: parsed.toString(), name: parsed.hostname }, importStatus: 'ready', exportLocation: null, error: null })
    } catch {
      set({ source: null, importStatus: 'error', error: get().language === 'ar' ? 'اكتب رابطًا صحيحًا يبدأ بـ https://' : 'Enter a valid video link starting with https://' })
    }
  },
  continueToWorkspace: () => {
    if (get().source) set({ screen: 'ready', error: null })
  },
  chooseExportLocation: async () => {
    const source = get().source
    if (!source) return
    try {
      if (source.kind === 'link') {
        set({ error: get().language === 'ar' ? 'تنزيل الفيديو من الرابط غير متاح بعد.' : 'Downloading videos from links is not connected yet.' })
        return
      }
      const baseName = source.name.replace(/\.[^.]+$/, '')
      const location = await window.youcut.chooseExportLocation(`${baseName}-short.mp4`)
      if (location) set({ exportLocation: location, error: null })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Export location could not be selected.' })
    }
  },
  clearSource: () => set({ source: null, exportLocation: null, importStatus: 'idle', screen: 'import', error: null }),
}))
