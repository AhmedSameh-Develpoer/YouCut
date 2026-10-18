export type PickedVideo = { path: string; name: string; sizeBytes: number; mediaUrl: string }
export type VideoSource = ({ kind: 'file' } & PickedVideo) | { kind: 'link'; url: string; name: string }
export type SaveLocation = { path: string; name: string }
export type FaceCamSettings = { enabled: boolean; x: number; y: number; width: number; height: number; size: number; placement: 'top' | 'bottom' | 'custom'; positionX: number; positionY: number }
export type FramingKeyframe = { time: number; cropX: number; cropY: number; zoom: number }
export type ExportOptions = { mediaUrl: string; start: number; end: number; cropX: number; cropY: number; zoom?: number; keyframes?: FramingKeyframe[]; muted: boolean; fps: 30 | 60; faceCam: FaceCamSettings }
export type ExportJob = { id: string; status: 'running' | 'complete' | 'cancelled' | 'error'; progress: number; path?: string; error?: string }
export type BatchClip = { id: string; name: string; start: number; end: number }
export type BatchExportItem = BatchClip & { status: 'queued' | 'running' | 'complete' | 'cancelled' | 'error'; progress: number; path?: string; error?: string }
export type BatchExportJob = { id: string; status: 'running' | 'complete' | 'cancelled'; progress: number; currentIndex: number | null; items: BatchExportItem[]; outputDirectory: string }
export type BatchExportRequest = { mediaUrl: string; clips: BatchClip[]; cropX: number; cropY: number; zoom?: number; keyframes?: FramingKeyframe[]; muted: boolean; fps: 30 | 60; faceCam: FaceCamSettings }
export type PreviewJob = { id: string; status: 'running' | 'complete' | 'cancelled' | 'error'; progress: number; mediaUrl?: string; error?: string }
export type SceneSuggestion = { id: string; start: number; end: number; score: number; reason: string }
export type AnalysisJob = { id: string; status: 'running' | 'complete' | 'cancelled' | 'error'; progress: number; range: { start: number; end: number }; sceneChanges: number[]; suggestions: SceneSuggestion[]; error?: string }
export type EditorSettings = { start: number; end: number; cropX: number; cropY: number; zoom?: number; keyframes?: FramingKeyframe[]; muted: boolean; fps: 30 | 60; faceCam: FaceCamSettings }
export type ProjectCategory = 'general' | 'gaming' | 'podcast' | 'interview' | 'reaction' | 'education'
export type ProjectDocument = {
  format: 'youcut-project'; schemaVersion: 1; projectId: string; name: string; category: ProjectCategory
  createdAt: string; modifiedAt: string
  source: { kind: 'file'; path: string; sizeBytes: number; modifiedAt: string }
  editor: EditorSettings
}
export type SaveProjectResult = { project: ProjectDocument; backupWarning?: string }
export type FlushProjectResult = { saved: boolean; backupSaved: boolean }
export type BackupSettings = { directory: string; available: boolean; isDefault: boolean }
export type RecentProject = { projectId: string; name: string; category: ProjectCategory; modifiedAt: string; lastOpenedAt: string; sourceName: string; sourceAvailable: boolean; projectAvailable: boolean }
export type OpenProject = { project: ProjectDocument; source: PickedVideo }
export type LinkImportJob = { id: string; status: 'running' | 'complete' | 'cancelled' | 'error'; stage: 'checking' | 'downloading' | 'saving' | 'complete'; progress: number; message?: string; error?: string; opened?: OpenProject }
export type ActivityEntry = { at: string; level: 'info' | 'warning' | 'error'; event: string; operationId?: string; details?: string }
export type YouCutDesktopApi = {
  pickVideo: () => Promise<PickedVideo | null>
  startLinkImport: (url: string, category: ProjectCategory) => Promise<LinkImportJob | null>
  getLinkImportJob: () => Promise<LinkImportJob | null>
  cancelLinkImport: () => Promise<void>
  createProject: (mediaUrl: string, name: string, category: ProjectCategory) => Promise<OpenProject | null>
  updateProjectCategory: (projectId: string, category: ProjectCategory) => Promise<ProjectDocument>
  listProjects: () => Promise<RecentProject[]>
  openProject: (projectId: string) => Promise<OpenProject>
  openProjectFile: (expectedProjectId?: string) => Promise<OpenProject | null>
  saveProject: (projectId: string, editor: EditorSettings) => Promise<SaveProjectResult>
  flushProject: (projectId: string, editor: EditorSettings) => FlushProjectResult
  startAnalysis: (mediaUrl: string, start: number, end: number) => Promise<AnalysisJob>
  getAnalysisJob: () => Promise<AnalysisJob | null>
  cancelAnalysis: () => Promise<void>
  preparePreview: (mediaUrl: string) => Promise<PreviewJob>
  getPreviewJob: (mediaUrl: string) => Promise<PreviewJob | null>
  cancelPreview: (mediaUrl: string) => Promise<void>
  startExport: (options: ExportOptions) => Promise<ExportJob | null>
  getExportJob: () => Promise<ExportJob | null>
  cancelExport: () => Promise<void>
  startBatchExport: (request: BatchExportRequest) => Promise<BatchExportJob | null>
  getBatchExportJob: () => Promise<BatchExportJob | null>
  cancelBatchExport: () => Promise<void>
  retryBatchExportItem: (index: number) => Promise<BatchExportJob>
  getRecentActivity: () => Promise<ActivityEntry[]>
  recordUiError: (message: string) => Promise<void>
  exportActivityReport: () => Promise<boolean>
  getBackupSettings: () => Promise<BackupSettings>
  chooseBackupDirectory: () => Promise<BackupSettings | null>
  getAppInfo: () => Promise<{ version: string; language: 'en' | 'ar' }>
}
