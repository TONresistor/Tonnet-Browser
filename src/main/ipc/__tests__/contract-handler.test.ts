import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { defineRequest } from '../../../shared/ipc-contract/definition'

let registered: ((...args: unknown[]) => Promise<unknown>) | null = null

vi.mock('../handlers/shared', () => ({
  IpcBoundaryError: class IpcBoundaryError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly retryable: boolean,
      readonly internalCause?: unknown
    ) {
      super(message)
    }
  },
  secureHandleWithEvent: vi.fn((_channel: string, handler: (...args: unknown[]) => unknown) => {
    registered = async (...args: unknown[]) => handler({ sender: { id: 1 } }, ...args)
  }),
  tonsiteHandle: vi.fn(),
}))

import { ipcFailure, secureContractHandle } from '../contract-handler'

const contract = defineRequest({
  channel: 'test:double',
  direction: 'request',
  caller: 'main-renderer',
  authorization: 'main-window',
  rateLimit: { kind: 'none' },
  input: z.tuple([z.number().int()]),
  output: z.object({ value: z.number().int() }),
  errors: ['INVALID_INPUT'],
  redaction: 'public',
})

describe('secureContractHandle', () => {
  beforeEach(() => {
    registered = null
  })

  it('validates input and output around the handler', async () => {
    secureContractHandle(contract, (value) => ({ value: value * 2 }))

    await expect(registered?.(4)).resolves.toEqual({ value: 8 })
    await expect(registered?.('4')).rejects.toThrow()
  })

  it('rejects handler output that violates the contract', async () => {
    secureContractHandle(contract, (_value) => ({ value: Number.NaN }))
    await expect(registered?.(4)).rejects.toThrow()
  })

  it('refuses callers that require a different origin adapter', () => {
    const tonsiteContract = { ...contract, caller: 'tonsite' as const }
    expect(() => secureContractHandle(tonsiteContract, (value) => ({ value }))).toThrow(/Unsupported secure IPC caller/)
  })

  it('never exposes an error code omitted from the operation contract', async () => {
    secureContractHandle(contract, () => ipcFailure('UNDECLARED_SECRET_FAILURE', 'Must not cross boundary'))

    await expect(registered?.(4)).rejects.toMatchObject({
      code: 'IPC_INTERNAL_ERROR',
      message: 'Operation failed',
      retryable: false,
    })
  })

  it('enforces a declared fixed-window policy before calling the handler', async () => {
    const limited = defineRequest({
      ...contract,
      channel: 'test:limited',
      rateLimit: { kind: 'fixed-window' as const, maxRequests: 1, windowMs: 1_000, key: 'sender' as const },
    })
    const handler = vi.fn((value: number) => ({ value }))
    secureContractHandle(limited, handler)

    await expect(registered?.(1)).resolves.toEqual({ value: 1 })
    await expect(registered?.(2)).rejects.toThrow('Too many requests')
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
