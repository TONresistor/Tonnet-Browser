/** Renderer-visible preload API inferred from the concrete contextBridge object. */
import type { ElectronAPI } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
  }
}

export {}
