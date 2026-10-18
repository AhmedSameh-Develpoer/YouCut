export type PickedVideo = {
  path: string
  name: string
  sizeBytes: number
}

export type VideoSource =
  | { kind: 'file'; path: string; name: string; sizeBytes: number }
  | { kind: 'link'; url: string; name: string }

export type SaveLocation = {
  path: string
  name: string
}

export type YouCutDesktopApi = {
  pickVideo: () => Promise<PickedVideo | null>
  chooseExportLocation: (suggestedName: string) => Promise<SaveLocation | null>
  getAppInfo: () => Promise<{ version: string; language: 'en' | 'ar' }>
}
