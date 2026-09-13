import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Window } from 'happy-dom'
import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getRecent: vi.fn(), getByDate: vi.fn() }))

vi.mock('@/features/history/client', () => ({ historyClient: mocks }))
vi.mock('@/features/browser/navigation', () => ({ useAddBrowserTab: () => vi.fn() }))
vi.mock('@/logger', () => ({ createLogger: () => ({ error: vi.fn() }) }))
vi.mock('@/i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
vi.mock('lottie-react', () => ({ default: () => null }))

import { HistoryPage } from '../HistoryPage'

it('restores unfiltered history when reopening after a date filter', async () => {
  const dom = new Window()
  vi.stubGlobal('window', dom)
  vi.stubGlobal('document', dom.document)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  const container = document.createElement('div')
  document.body.appendChild(container)
  let root = createRoot(container)
  const older = { id: 'old', title: 'Older entry', url: 'http://old.ton', visitedAt: 1, visitCount: 1 }
  const recent = { id: 'new', title: 'Recent entry', url: 'http://new.ton', visitedAt: Date.now(), visitCount: 1 }
  mocks.getRecent.mockResolvedValueOnce([older, recent]).mockImplementation(() => new Promise(() => {}))
  mocks.getByDate.mockResolvedValue([recent])

  try {
    await act(async () => root.render(<HistoryPage />))
    await act(async () => vi.runOnlyPendingTimersAsync())
    expect(container.textContent).toContain('Older entry')

    const week = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
      (button) => button.textContent === 'history.filters.thisWeek'
    )!
    await act(async () => week.click())
    await act(async () => vi.runOnlyPendingTimersAsync())
    expect(container.textContent).not.toContain('Older entry')

    await act(async () => root.unmount())
    root = createRoot(container)
    await act(async () => root.render(<HistoryPage />))

    expect(container.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe('history.filters.all')
    expect(container.textContent).toContain('Older entry')
  } finally {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    await dom.happyDOM.abort()
  }
})
