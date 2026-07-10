import type { IpcRequestContract } from '../../shared/ipc-contract/definition'
import type { IpcMainInvokeEvent } from 'electron'
import { IpcBoundaryError, overlayHandle, secureHandleWithEvent, tonsiteHandle } from './handlers/shared'
import { DisposableStore, onEmitter, type IDisposable } from '../utils/disposable'
import type { EventEmitter } from 'node:events'

/** Abort an IPC operation with a stable public error and a local-only cause. */
export function ipcFailure(code: string, message: string, retryable = false, cause?: unknown): never {
  throw new IpcBoundaryError(code, message, retryable, cause)
}

let activeRegistrationScope: DisposableStore | null = null

export function withIpcRegistrationScope<T>(scope: DisposableStore, register: () => T): T {
  if (activeRegistrationScope) throw new Error('Nested IPC registration scopes are not supported')
  activeRegistrationScope = scope
  try {
    return register()
  } finally {
    activeRegistrationScope = null
  }
}

function ownRegistration(disposable: IDisposable): void {
  activeRegistrationScope?.add(disposable)
}

export function ownIpcEmitterListener<TArgs extends unknown[]>(
  emitter: EventEmitter,
  event: string,
  listener: (...args: TArgs) => void
): void {
  if (!activeRegistrationScope) throw new Error(`IPC emitter listener registered outside scope: ${event}`)
  activeRegistrationScope.add(onEmitter(emitter, event, listener))
}

function createRateLimitGuard(contract: IpcRequestContract<readonly unknown[], unknown>): (key: string) => void {
  if (contract.rateLimit.kind === 'none') return () => undefined
  const policy = contract.rateLimit
  const buckets = new Map<string, number[]>()
  return (key: string): void => {
    const now = Date.now()
    const cutoff = now - policy.windowMs
    const recent = (buckets.get(key) ?? []).filter((timestamp) => timestamp > cutoff)
    if (recent.length >= policy.maxRequests) {
      throw new IpcBoundaryError('RATE_LIMITED', 'Too many requests', true)
    }
    recent.push(now)
    buckets.set(key, recent)
  }
}

function parseInput<TArgs extends readonly unknown[]>(
  contract: IpcRequestContract<TArgs, unknown>,
  raw: unknown[]
): TArgs {
  try {
    return contract.input.parse(raw)
  } catch (error) {
    throw new IpcBoundaryError('INVALID_INPUT', 'Invalid request payload', false, error)
  }
}

async function runHandler<TArgs extends readonly unknown[], TResult>(
  contract: IpcRequestContract<TArgs, TResult>,
  operation: () => TResult | Promise<TResult>
): Promise<TResult> {
  let result: TResult
  try {
    result = await operation()
  } catch (error) {
    if (error instanceof IpcBoundaryError) {
      if (contract.errors.includes(error.code)) throw error
      throw new IpcBoundaryError('IPC_INTERNAL_ERROR', 'Operation failed', false, error)
    }
    const code =
      [...contract.errors].reverse().find((candidate) => candidate.endsWith('_FAILED')) ?? 'IPC_OPERATION_FAILED'
    throw new IpcBoundaryError(code, 'Operation failed', false, error)
  }
  try {
    return contract.output.parse(result)
  } catch (error) {
    throw new IpcBoundaryError('CONTRACT_OUTPUT_INVALID', 'Operation failed', false, error)
  }
}

export function secureContractHandle<TArgs extends readonly unknown[], TResult>(
  contract: IpcRequestContract<TArgs, TResult>,
  handler: (...args: NoInfer<TArgs>) => TResult | Promise<TResult>
): void {
  if (contract.caller !== 'main-renderer') {
    throw new Error(`Unsupported secure IPC caller for ${contract.channel}: ${contract.caller}`)
  }
  const enforceRateLimit = createRateLimitGuard(contract)

  ownRegistration(
    secureHandleWithEvent(contract.channel, async (event, ...rawArgs: unknown[]) => {
      enforceRateLimit(`sender:${event.sender.id}`)
      const args = parseInput(contract, rawArgs)
      return runHandler(contract, () => handler(...args))
    })
  )
}

export function tonsiteContractHandle<TArgs extends readonly unknown[], TResult>(
  contract: IpcRequestContract<TArgs, TResult>,
  handler: (domain: string, event: IpcMainInvokeEvent, ...args: NoInfer<TArgs>) => TResult | Promise<TResult>
): void {
  if (contract.caller !== 'tonsite' || contract.authorization !== 'owning-tonsite-session') {
    throw new Error(`Unsupported tonsite IPC policy for ${contract.channel}`)
  }
  const enforceRateLimit = createRateLimitGuard(contract)
  ownRegistration(
    tonsiteHandle(contract.channel, async (domain, event, ...rawArgs: unknown[]) => {
      enforceRateLimit(
        contract.rateLimit.kind === 'fixed-window' && contract.rateLimit.key === 'domain'
          ? domain
          : `sender:${event.sender.id}`
      )
      const args = parseInput(contract, rawArgs)
      return runHandler(contract, () => handler(domain, event, ...args))
    })
  )
}

export function overlayContractHandle<TArgs extends readonly unknown[], TResult>(
  contract: IpcRequestContract<TArgs, TResult>,
  isAuthorized: (event: IpcMainInvokeEvent) => boolean,
  handler: (event: IpcMainInvokeEvent, ...args: NoInfer<TArgs>) => TResult | Promise<TResult>
): void {
  if (contract.caller !== 'overlay' || contract.authorization !== 'overlay-window') {
    throw new Error(`Unsupported overlay IPC policy for ${contract.channel}`)
  }
  const enforceRateLimit = createRateLimitGuard(contract)
  ownRegistration(
    overlayHandle(contract.channel, isAuthorized, async (event, ...rawArgs: unknown[]) => {
      enforceRateLimit(`sender:${event.sender.id}`)
      const args = parseInput(contract, rawArgs)
      return runHandler(contract, () => handler(event, ...args))
    })
  )
}
