import type { YouCutDesktopApi } from '../shared/contracts'

declare global {
  interface Window {
    youcut: YouCutDesktopApi
  }
}

export {}
