import type { SettingsChangedEvent } from '@shared/ipc-events'
import type { AppearanceSettings } from '@shared/types'

export const themeClient = {
  isAvailable: () => typeof window !== 'undefined' && Boolean(window.electron),
  getAppearance: () => window.electron.settings.get('appearance'),
  applyAppearance: async (patch: Partial<AppearanceSettings>): Promise<AppearanceSettings> => {
    const settings = await window.electron.settings.apply({ appearance: patch })
    return settings.appearance
  },
  onChanged: (listener: (change: SettingsChangedEvent) => void) => window.electron.on('settings:changed', listener),
}
