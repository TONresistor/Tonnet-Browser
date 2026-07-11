import type { z } from 'zod'

export type IpcCaller = 'main-renderer' | 'tonsite' | 'overlay'
export type RedactionClass = 'public' | 'sensitive' | 'secret'
export type IpcAuthorization = 'main-window' | 'owning-tonsite-session' | 'overlay-window'

export type IpcRateLimit =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'fixed-window'
      readonly maxRequests: number
      readonly windowMs: number
      readonly key: 'sender' | 'domain'
    }

export interface IpcRequestContract<TArgs extends readonly unknown[], TResult> {
  readonly channel: string
  readonly direction: 'request'
  readonly caller: IpcCaller
  readonly authorization: IpcAuthorization
  readonly rateLimit: IpcRateLimit
  readonly input: z.ZodType<TArgs>
  readonly output: z.ZodType<TResult>
  readonly errors: readonly string[]
  readonly redaction: RedactionClass
}

export function defineRequest<const TChannel extends string, TArgs extends readonly unknown[], TResult>(
  contract: Omit<IpcRequestContract<TArgs, TResult>, 'channel'> & { readonly channel: TChannel }
): IpcRequestContract<TArgs, TResult> & { readonly channel: TChannel } {
  return Object.freeze(contract)
}

export interface IpcEventContract<TPayload> {
  readonly channel: string
  readonly direction: 'event'
  readonly recipient: IpcCaller
  readonly payload: z.ZodType<TPayload>
  readonly redaction: RedactionClass
}

export function defineEvent<const TChannel extends string, TPayload>(
  contract: Omit<IpcEventContract<TPayload>, 'channel'> & { readonly channel: TChannel }
): IpcEventContract<TPayload> & { readonly channel: TChannel } {
  return Object.freeze(contract)
}

export type RequestArgs<TContract> = TContract extends IpcRequestContract<infer TArgs, unknown> ? TArgs : never
export type RequestResult<TContract> =
  TContract extends IpcRequestContract<readonly unknown[], infer TResult> ? TResult : never
