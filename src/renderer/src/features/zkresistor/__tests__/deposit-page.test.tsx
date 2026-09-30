// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prepare: vi.fn<() => Promise<{ id: string; note: string }>>(),
  submit: vi.fn(async () => {}),
  discard: vi.fn(),
  reload: vi.fn(async () => {}),
  wallet: {
    init: async () => {},
    isCreated: true,
    address: 'wallet',
    isLocked: false,
    needsPasswordSetup: false,
    backupVerified: true,
  },
}))
vi.mock('../private-runtime', () => ({
  prepareGramDeposit: mocks.prepare,
  submitGramDeposit: mocks.submit,
  discardPreparedDeposit: mocks.discard,
}))
vi.mock('@/features/wallet/store', () => ({
  useWalletStore: (select: (state: typeof mocks.wallet) => unknown) => select(mocks.wallet),
}))
vi.mock('@/features/browser/navigation', () => ({ browserNavigation: { navigateActiveTab: vi.fn() } }))
vi.mock('../useCatalog', () => ({
  useZkResistorCatalog: () => ({
    catalog: {
      pools: [
        {
          address: 'pool',
          denomination: '1000000000',
          decimals: 9,
          symbol: 'GRAM',
          shieldedAmount: '0',
          shieldedDeposits: 0,
          nextIndex: 0,
          withdrawalCount: 0,
        },
      ],
    },
    loading: false,
    error: null,
    reload: mocks.reload,
  }),
}))
import PoolPage from '../components/ZkResistorPoolPage'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: ReturnType<typeof createRoot>
let container: HTMLDivElement
beforeEach(async () => {
  mocks.prepare.mockReset().mockResolvedValue({ id: 'first', note: 'FIRST-NOTE' })
  mocks.submit.mockClear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<PoolPage poolAddress="pool" />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((item) => item.textContent === label)
  expect(found).toBeDefined()
  return found!
}
async function click(label: string) {
  await act(async () => button(label).click())
}
async function confirmNote() {
  await act(async () => container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click())
}
async function firstDeposit() {
  await click('Generate secret note')
  await confirmNote()
  await click('Deposit 1 GRAM')
  expect(container.textContent).toContain('Deposit submitted.')
}
it('allows two deposits and replaces the previous note only when the new note is ready', async () => {
  await firstDeposit()
  let resolve!: (value: { id: string; note: string }) => void
  mocks.prepare.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done
    })
  )
  await click('New deposit')
  expect(container.textContent).toContain('FIRST-NOTE')
  expect(button('New deposit').disabled).toBe(true)
  await act(async () => resolve({ id: 'second', note: 'SECOND-NOTE' }))
  expect(container.textContent).toContain('SECOND-NOTE')
  expect(container.textContent).not.toContain('FIRST-NOTE')
  expect(container.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false)
  expect(button('Deposit 1 GRAM').disabled).toBe(true)
  await confirmNote()
  await click('Deposit 1 GRAM')
  expect(mocks.submit).toHaveBeenCalledTimes(2)
  expect(mocks.submit).toHaveBeenLastCalledWith('second', 'wallet', expect.any(Function))
})
it('keeps the previous note and permits retry if preparing the next deposit fails', async () => {
  await firstDeposit()
  mocks.prepare.mockRejectedValueOnce(new Error('Indexer unavailable'))
  await click('New deposit')
  expect(container.textContent).toContain('FIRST-NOTE')
  expect(container.textContent).toContain('Indexer unavailable')
  expect(button('Copy')).toBeDefined()
  expect(button('New deposit').disabled).toBe(false)
  mocks.prepare.mockResolvedValueOnce({ id: 'second', note: 'SECOND-NOTE' })
  await click('New deposit')
  expect(container.textContent).toContain('SECOND-NOTE')
  expect(button('Deposit 1 GRAM').disabled).toBe(true)
})
