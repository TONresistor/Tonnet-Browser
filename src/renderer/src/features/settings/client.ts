import type { SettingsChangedEvent } from '@shared/ipc-events'
import type { SettingsPatch } from '@shared/ipc-contract/settings'
import type { AppSettings } from '@shared/types'

/** Typed main-process boundary owned by settings and preferences. */
export const settingsClient = {
  isAvailable: () => typeof window !== 'undefined' && Boolean(window.electron),
  getAll: () => window.electron.settings.getAll(),
  get: <K extends keyof AppSettings>(category: K) => window.electron.settings.get(category),
  set: <K extends keyof AppSettings>(category: K, values: Partial<AppSettings[K]>) =>
    window.electron.settings.set(category, { ...values }),
  apply: (patch: SettingsPatch) => window.electron.settings.apply(patch),
  reset: () => window.electron.settings.reset(),
  diagnostics: {
    get: () => window.electron.settings.diagnostics.get(),
    enable: () => window.electron.settings.diagnostics.enable(),
    disable: () => window.electron.settings.diagnostics.disable(),
    copy: () => window.electron.settings.diagnostics.copy(),
  },
  clearBrowsingData: () => window.electron.clearBrowsingData(),
  onChanged: (listener: (change: SettingsChangedEvent) => void) => window.electron.on('settings:changed', listener),
}
