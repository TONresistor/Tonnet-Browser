// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ZkResistorCatalog } from '@shared/types'

const mocks = vi.hoisted(() => ({ catalog: vi.fn() }))
vi.mock('../client', () => ({ zkResistorClient: mocks }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const roots: ReturnType<typeof createRoot>[] = []
const containers: HTMLDivElement[] = []
const catalog = (loadedAt: string): ZkResistorCatalog => ({
  factoryAddress: 'factory',
  sdkVersion: '2.0.1',
  loadedAt,
  pools: [],
})

beforeEach(() => {
  vi.resetModules()
  mocks.catalog.mockReset()
})
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  for (const container of containers.splice(0)) container.remove()
})

async function mount() {
  const { useZkResistorCatalog } = await import('../useCatalog')
  let state!: ReturnType<typeof useZkResistorCatalog>
  function Probe() {
    state = useZkResistorCatalog()
    return <span>{state.catalog?.loadedAt}</span>
  }
  const container = document.createElement('div')
  document.body.append(container)
  containers.push(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(<Probe />))
  return {
    container,
    state: () => state,
    unmount: async () => {
      await act(async () => root.unmount())
      roots.splice(roots.indexOf(root), 1)
    },
  }
}

describe('ZKR catalog revalidation', () => {
  it('shows the cached catalog immediately but reads fresh data when reopened', async () => {
    mocks.catalog.mockResolvedValueOnce(catalog('old'))
    const first = await mount()
    expect(first.container.textContent).toBe('old')
    await first.unmount()
    let resolve!: (value: ZkResistorCatalog) => void
    mocks.catalog.mockReturnValueOnce(
      new Promise<ZkResistorCatalog>((done) => {
        resolve = done
      })
    )
    const reopened = await mount()
    expect(reopened.container.textContent).toBe('old')
    expect(reopened.state().loading).toBe(true)
    expect(mocks.catalog).toHaveBeenCalledTimes(2)
    await act(async () => resolve(catalog('fresh')))
    expect(reopened.container.textContent).toBe('fresh')
    expect(reopened.state().loading).toBe(false)
  })

  it('shares an in-flight read between concurrent consumers', async () => {
    let resolve!: (value: ZkResistorCatalog) => void
    mocks.catalog.mockReturnValueOnce(
      new Promise<ZkResistorCatalog>((done) => {
        resolve = done
      })
    )
    const first = await mount()
    const second = await mount()
    expect(mocks.catalog).toHaveBeenCalledOnce()
    await act(async () => resolve(catalog('fresh')))
    expect(first.container.textContent).toBe('fresh')
    expect(second.container.textContent).toBe('fresh')
  })

  it('retains the last catalog on refresh failure and permits an explicit retry', async () => {
    mocks.catalog.mockResolvedValueOnce(catalog('old'))
    const first = await mount()
    await first.unmount()
    mocks.catalog.mockRejectedValueOnce(new Error('Bridge disconnected'))
    const reopened = await mount()
    expect(reopened.container.textContent).toBe('old')
    expect(reopened.state().error).toBe('Bridge disconnected')
    mocks.catalog.mockResolvedValueOnce(catalog('recovered'))
    await act(async () => {
      await reopened.state().reload()
    })
    expect(reopened.container.textContent).toBe('recovered')
    expect(reopened.state().error).toBeNull()
    expect(mocks.catalog).toHaveBeenCalledTimes(3)
  })
})
