import { create } from 'zustand'
import type { EditorSettings, OpenProject, ProjectCategory, RecentProject, VideoSource } from '../../../shared/contracts'

type Screen = 'projects' | 'import' | 'ready'
type ImportStatus = 'idle' | 'choosing' | 'ready' | 'link-ready' | 'error'
let pickerRequest = 0

export const useWorkspace = create<{
  screen: Screen; importStatus: ImportStatus; source: VideoSource | null
  error: string | null; language: 'en' | 'ar'; languageTouched: boolean
  currentProjectId: string | null; currentProjectCategory: ProjectCategory | null; categorySaving: boolean; categoryError: string | null
  currentSettings: EditorSettings | null; projects: RecentProject[]; projectsLoading: boolean; projectsError: string | null; projectOperation: 'idle' | 'creating' | 'opening'
  goTo: (screen: Screen) => void; toggleLanguage: () => void
  setSystemLanguage: (language: 'en' | 'ar') => void
  pickVideo: () => Promise<void>; cancelImport: () => void
  setVideoLink: (url: string) => void; continueToWorkspace: (category: ProjectCategory) => Promise<void>
  acceptImportedProject: (opened: OpenProject) => void
  clearSource: () => void; updateProjectCategory: (category: ProjectCategory) => Promise<void>; loadRecentProjects: () => Promise<void>; openProject: (id: string) => Promise<void>
  openProjectFile: (expectedProjectId?: string) => Promise<void>
}>((set, get) => ({
  screen: 'projects', importStatus: 'idle', source: null,
  error: null, language: 'en', languageTouched: false,
  currentProjectId: null, currentProjectCategory: null, categorySaving: false, categoryError: null,
  currentSettings: null, projects: [], projectsLoading: true, projectsError: null, projectOperation: 'idle',
  goTo: (screen) => { pickerRequest++; set({ screen, importStatus: get().source?.kind === 'file' ? 'ready' : get().source ? 'link-ready' : 'idle', error: null }) },
  toggleLanguage: () => set((s) => ({ language: s.language === 'en' ? 'ar' : 'en', languageTouched: true })),
  setSystemLanguage: (language) => set((s) => s.languageTouched ? {} : { language }),
  pickVideo: async () => {
    if (get().importStatus === 'choosing') return
    const request = ++pickerRequest
    set({ importStatus: 'choosing', error: null })
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      const source = await Promise.race([window.youcut.pickVideo(), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('PICKER_TIMEOUT')), 60000) })])
      if (request !== pickerRequest) return
      if (!source) { set({ importStatus: get().source?.kind === 'file' ? 'ready' : get().source ? 'link-ready' : 'idle' }); return }
      set({ source: { kind: 'file', ...source }, importStatus: 'ready', screen: 'import' })
    } catch {
      if (request === pickerRequest) set({ importStatus: 'error', error: 'picker' })
    } finally { clearTimeout(timeout) }
  },
  cancelImport: () => { pickerRequest++; set({ importStatus: get().source?.kind === 'file' ? 'ready' : get().source ? 'link-ready' : 'idle', error: null }) },
  setVideoLink: (url) => {
    pickerRequest++
    const trimmed = url.trim()
    if (!trimmed) { set({ source: null, importStatus: 'idle', error: null }); return }
    try {
      const parsed = new URL(trimmed)
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) throw new Error()
      set({ source: { kind: 'link', url: parsed.toString(), name: parsed.hostname }, importStatus: 'link-ready', error: null })
    } catch { set({ source: null, importStatus: 'error', error: 'invalid-link' }) }
  },
  continueToWorkspace: async (category) => {
    const source = get().source
    if (source?.kind !== 'file' || get().importStatus !== 'ready' || get().projectOperation !== 'idle') return
    set({ projectOperation: 'creating', projectsError: null })
    try {
      const opened = await window.youcut.createProject(source.mediaUrl, source.name.replace(/\.[^.]+$/, ''), category)
      if (!opened) return
      set({ source: { kind: 'file', ...opened.source }, currentProjectId: opened.project.projectId, currentProjectCategory: opened.project.category, categoryError: null, currentSettings: opened.project.editor, screen: 'ready', error: null })
      await get().loadRecentProjects()
    } catch (error) { set({ projectsError: error instanceof Error ? error.message : 'Project could not be created.' }) }
    finally { set({ projectOperation: 'idle' }) }
  },
  acceptImportedProject: (opened) => set({ source: { kind: 'file', ...opened.source }, currentProjectId: opened.project.projectId, currentProjectCategory: opened.project.category, categoryError: null, currentSettings: opened.project.editor, screen: 'ready', importStatus: 'ready', error: null }),
  clearSource: () => { pickerRequest++; set({ source: null, currentProjectId: null, currentProjectCategory: null, categoryError: null, currentSettings: null, importStatus: 'idle', screen: 'projects', error: null }) },
  updateProjectCategory: async (category) => {
    const projectId = get().currentProjectId
    if (!projectId || get().categorySaving || get().currentProjectCategory === category) return
    set({ categorySaving: true, categoryError: null })
    try {
      const project = await window.youcut.updateProjectCategory(projectId, category)
      set(state => ({ currentProjectCategory: project.category, projects: state.projects.map(item => item.projectId === projectId ? { ...item, category: project.category, modifiedAt: project.modifiedAt } : item) }))
    } catch (error) {
      set({ categoryError: error instanceof Error ? error.message : 'Project category could not be updated.' })
    } finally { set({ categorySaving: false }) }
  },
  loadRecentProjects: async () => {
    set({ projectsLoading: true })
    try { set({ projects: await window.youcut.listProjects(), projectsError: null }) }
    catch (error) { set({ projectsError: error instanceof Error ? error.message : 'Recent projects could not be loaded.' }) }
    finally { set({ projectsLoading: false }) }
  },
  openProject: async (id) => {
    if (get().projectOperation !== 'idle') return
    set({ projectOperation: 'opening', projectsError: null })
    try {
      const opened = await window.youcut.openProject(id)
      set({ source: { kind: 'file', ...opened.source }, currentProjectId: opened.project.projectId, currentProjectCategory: opened.project.category, categoryError: null, currentSettings: opened.project.editor, screen: 'ready', importStatus: 'ready' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Project could not be opened.'
      const language = get().language
      set({ projectsError: message === 'SOURCE_RELINK_CANCELLED'
        ? (language === 'ar' ? 'تم إلغاء اختيار الفيديو. المشروع ما زال محفوظًا في Recent.' : 'Source selection was cancelled. The project remains in Recent.')
        : message === 'SOURCE_DURATION_TOO_SHORT'
          ? (language === 'ar' ? 'الفيديو المختار أقصر من نهاية القص المحفوظ. اختر المصدر الصحيح.' : 'The selected video is shorter than the saved clip end. Choose the correct source.')
          : message === 'PROJECT_RECOVERY_CANCELLED' || message === 'PROJECT_RECOVERY_REQUIRED'
            ? (language === 'ar' ? 'لم يتم استرداد المشروع؛ الملف الأصلي غير صالح ولا توجد نسخة سابقة صالحة لفتحها.' : 'The project was not recovered. The original file is invalid and no valid version was opened.')
          : message })
    }
    finally { set({ projectOperation: 'idle' }) }
  },
  openProjectFile: async (expectedProjectId) => {
    if (get().projectOperation !== 'idle') return
    set({ projectOperation: 'opening', projectsError: null })
    try {
      const opened = await window.youcut.openProjectFile(expectedProjectId)
      if (!opened) return
      set({ source: { kind: 'file', ...opened.source }, currentProjectId: opened.project.projectId, currentProjectCategory: opened.project.category, categoryError: null, currentSettings: opened.project.editor, screen: 'ready', importStatus: 'ready' })
      await get().loadRecentProjects()
    } catch (error) {
      set({ projectsError: error instanceof Error ? error.message : 'Project file could not be opened.' })
    } finally { set({ projectOperation: 'idle' }) }
  },
}))
