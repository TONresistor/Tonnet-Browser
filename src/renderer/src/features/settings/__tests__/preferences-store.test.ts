import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppSettingsSchema } from '@shared/types'

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  isAvailable: vi.fn(() => false),
  onChanged: vi.fn(() => vi.fn()),
}))

vi.mock('@/features/settings/client', () => ({
  settingsClient: {
    apply: mocks.apply,
    isAvailable: mocks.isAvailable,
    onChanged: mocks.onChanged,
  },
}))

vi.mock('@/logger', () => ({
  createLogger: () => ({ error: vi.fn() }),
}))

describe('preferences store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('preserves edits made while a save is in flight', async () => {
    let resolveApply!: (settings: ReturnType<typeof AppSettingsSchema.parse>) => void
    mocks.apply.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveApply = resolve
      })
    )
    const { defaultPreferences, usePreferencesStore } = await import('../preferences-store')
    usePreferencesStore.setState({
      saved: { ...defaultPreferences },
      draft: { ...defaultPreferences, proxyPort: 9000 },
      isLoaded: true,
      hasChanges: true,
      isSaving: false,
    })

    const saving = usePreferencesStore.getState().save()
    usePreferencesStore.getState().setDraft('proxyPort', 9100)
    resolveApply(AppSettingsSchema.parse({ network: { proxyPort: 9000 } }))
    await saving

    const state = usePreferencesStore.getState()
    expect(state.saved.proxyPort).toBe(9000)
    expect(state.draft.proxyPort).toBe(9100)
    expect(state.hasChanges).toBe(true)
    expect(state.isSaving).toBe(false)
  })

  it('rejects a failed batch so later save stages can stop', async () => {
    mocks.apply.mockRejectedValueOnce(new Error('runtime failed'))
    const { defaultPreferences, usePreferencesStore } = await import('../preferences-store')
    usePreferencesStore.setState({
      saved: { ...defaultPreferences },
      draft: { ...defaultPreferences, proxyPort: 9000 },
      isLoaded: true,
      hasChanges: true,
      isSaving: false,
    })

    await expect(usePreferencesStore.getState().save()).rejects.toThrow('runtime failed')
    expect(usePreferencesStore.getState().hasChanges).toBe(true)
    expect(usePreferencesStore.getState().isSaving).toBe(false)
  })
})
