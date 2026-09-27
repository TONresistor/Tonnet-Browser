// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

const nodeBuffer = globalThis.Buffer

afterEach(() => {
  Object.defineProperty(globalThis, 'Buffer', {
    configurable: true,
    writable: true,
    value: nodeBuffer,
  })
})

describe('ZKResistor private runtime', () => {
  it('loads without a Node-provided Buffer global', async () => {
    Object.defineProperty(globalThis, 'Buffer', {
      configurable: true,
      writable: true,
      value: undefined,
    })
    vi.resetModules()

    await expect(import('../private-runtime')).resolves.toBeDefined()
  })
})
