// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePrepareZkResistorResources, useZkResistorResources } from '../resources-store'
import { ZkResistorResourceStatus } from '../components/ZkResistorResourceStatus'

const mocks = vi.hoisted(() => ({
  preferences: { isLoaded: true, saved: { zkResistorEnabled: false } },
  prepare: vi.fn(),
  status: vi.fn(),
}))
vi.mock('@/features/settings/preferences-store', () => ({
  usePreferencesStore: (select: (s: typeof mocks.preferences) => unknown) => select(mocks.preferences),
}))
vi.mock('../client', () => ({ zkResistorClient: { prepareResources: mocks.prepare, resourceStatus: mocks.status } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: ReturnType<typeof createRoot>
let container: HTMLDivElement
function Bootstrap() {
  usePrepareZkResistorResources()
  return <ZkResistorResourceStatus />
}
async function render() {
  await act(async () => root.render(<Bootstrap />))
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.preferences.saved.zkResistorEnabled = false
  useZkResistorResources.setState({
    state: { status: 'idle', receivedBytes: 0, totalBytes: 0, error: null },
    retryCount: 0,
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
})
describe('ZKR activation download', () => {
  it('starts on saved activation, displays progress and stops polling after disabling', async () => {
    mocks.prepare.mockResolvedValue({ status: 'downloading', receivedBytes: 25, totalBytes: 100, error: null })
    mocks.status.mockResolvedValue({ status: 'ready', receivedBytes: 100, totalBytes: 100, error: null })
    await render()
    expect(mocks.prepare).not.toHaveBeenCalled()
    mocks.preferences.saved.zkResistorEnabled = true
    await render()
    expect(mocks.prepare).toHaveBeenCalledOnce()
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('25')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(useZkResistorResources.getState().state.status).toBe('ready')
    mocks.preferences.saved.zkResistorEnabled = false
    await render()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000)
    })
    expect(mocks.status).toHaveBeenCalledOnce()
  })
  it('offers a retry after a download failure', async () => {
    mocks.preferences.saved.zkResistorEnabled = true
    mocks.prepare
      .mockResolvedValueOnce({ status: 'error', receivedBytes: 0, totalBytes: 100, error: 'offline' })
      .mockResolvedValueOnce({ status: 'ready', receivedBytes: 100, totalBytes: 100, error: null })
    await render()
    expect(container.querySelector('button')).not.toBeNull()
    await act(async () => container.querySelector('button')!.click())
    expect(mocks.prepare).toHaveBeenCalledTimes(2)
    expect(useZkResistorResources.getState().state.status).toBe('ready')
  })
})
