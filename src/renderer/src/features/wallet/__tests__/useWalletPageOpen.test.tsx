// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { useWalletPageOpen } from '../useWalletPageOpen'
import { withWalletActivity } from '../activity'
import { walletClient } from '../client'

vi.mock('../client', () => ({
  walletClient: { isAvailable: () => true, setPageOpen: vi.fn().mockResolvedValue({ success: true }) },
}))
function View({ open }: { open: boolean }) {
  useWalletPageOpen(open)
  return null
}
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
it('renews only while a wallet surface is displayed and releases on navigation or unmount', () => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const root = createRoot(document.createElement('div'))
  act(() => root.render(<View open={false} />))
  expect(walletClient.setPageOpen).not.toHaveBeenCalled()
  act(() => root.render(<View open />))
  expect(walletClient.setPageOpen).toHaveBeenLastCalledWith(true)
  act(() => vi.advanceTimersByTime(30_000))
  expect(walletClient.setPageOpen).toHaveBeenCalledTimes(3)
  act(() => root.render(<View open={false} />))
  expect(walletClient.setPageOpen).toHaveBeenLastCalledWith(false)
  act(() => vi.advanceTimersByTime(60_000))
  expect(walletClient.setPageOpen).toHaveBeenCalledTimes(4)
  act(() => root.render(<View open />))
  act(() => root.unmount())
  expect(walletClient.setPageOpen).toHaveBeenLastCalledWith(false)
  expect(vi.getTimerCount()).toBe(0)
})

it.each([false, true])(
  'keeps an action protected after navigating away and releases on completion (failure=%s)',
  async (fails) => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const root = createRoot(document.createElement('div'))
    act(() => root.render(<View open />))
    let finish!: () => void
    const waiting = new Promise<void>((resolve) => {
      finish = resolve
    })
    const pending = withWalletActivity(async () => {
      await waiting
      if (fails) throw new Error('cancelled')
    })
    const result = pending.catch((error: Error) => error.message)
    act(() => root.render(<View open={false} />))
    act(() => vi.advanceTimersByTime(10 * 60_000))
    expect(walletClient.setPageOpen).toHaveBeenLastCalledWith(true)
    expect(vi.mocked(walletClient.setPageOpen).mock.calls.every(([open]) => open)).toBe(true)
    finish()
    expect(await result).toBe(fails ? 'cancelled' : undefined)
    expect(walletClient.setPageOpen).toHaveBeenLastCalledWith(false)
    expect(vi.getTimerCount()).toBe(0)
    act(() => root.unmount())
  }
)
