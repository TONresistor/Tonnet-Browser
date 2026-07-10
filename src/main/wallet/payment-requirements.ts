import { rawToFriendly } from './address-utils'
import {
  AUTO_PAY_DEFAULT_MAX_PER_REQUEST,
  FETCH_TIMEOUT_MS,
  MAX_SINGLE_PAYMENT,
  TON_MAINNET_CAIP2,
  TON_NATIVE_ASSET,
  WALLET_MAX_TIMEOUT_S,
  WALLET_MIN_APPROVAL_TIMEOUT_S,
} from './constants'
import { PaymentRequirementsSchema } from '../../shared/schemas'
import type { PaymentMode, PaymentNotificationData, PaymentRequirements, WalletState } from '../../shared/types'

export const MAX_PAYMENT_RESPONSE_BYTES = 65_536
const TON_RAW_ADDRESS_RE = /^0:[0-9a-fA-F]{64}$/

export interface PaymentFetchPort {
  fetch(url: string, options?: RequestInit): Promise<Response>
}

export async function fetchPaymentResource(
  session: PaymentFetchPort,
  url: string,
  options?: RequestInit
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await session.fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

export async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader?.()
  if (!reader) {
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error(`Response body exceeds ${maxBytes} bytes`)
    return text
  }

  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error(`Response body exceeds ${maxBytes} bytes`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock?.()
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8').decode(merged)
}

export async function parsePaymentRequirements(response: Response): Promise<PaymentRequirements> {
  const advertisedSize = Number.parseInt(response.headers?.get?.('content-length') ?? '0', 10)
  if (advertisedSize > MAX_PAYMENT_RESPONSE_BYTES) {
    throw new Error(`Response body exceeds ${MAX_PAYMENT_RESPONSE_BYTES} bytes`)
  }
  const body = await readBoundedBody(response, MAX_PAYMENT_RESPONSE_BYTES)
  return PaymentRequirementsSchema.parse(JSON.parse(body))
}

export interface PaymentValidationContext {
  originalDomain: string
  finalDomain: string
  isAutoMode: boolean
  walletState: Pick<WalletState, 'isCreated' | 'addressRaw'>
  perRequestLimit: string
}

export function validatePaymentRequirements(
  requirements: PaymentRequirements,
  context: PaymentValidationContext
): { valid: boolean; reason?: string } {
  if (requirements.scheme !== 'exact') return { valid: false, reason: `Invalid scheme: ${requirements.scheme}` }
  if (requirements.network !== TON_MAINNET_CAIP2) {
    return { valid: false, reason: `Invalid network: ${requirements.network}` }
  }
  if (requirements.asset !== TON_NATIVE_ASSET) return { valid: false, reason: `Invalid asset: ${requirements.asset}` }

  let amount: bigint
  try {
    amount = BigInt(requirements.amount)
    if (amount <= 0n) return { valid: false, reason: 'Amount must be > 0' }
  } catch {
    return { valid: false, reason: `Invalid amount: ${requirements.amount}` }
  }

  const effectiveLimit = context.perRequestLimit !== '0' ? BigInt(context.perRequestLimit) : MAX_SINGLE_PAYMENT
  if (amount > effectiveLimit) return { valid: false, reason: 'amount_exceeds_limit' }
  if (!context.walletState.isCreated) return { valid: false, reason: 'Wallet not created' }
  if (!TON_RAW_ADDRESS_RE.test(requirements.payTo)) {
    return { valid: false, reason: `Invalid payTo address: ${requirements.payTo}` }
  }
  if (
    requirements.maxTimeoutSeconds < WALLET_MIN_APPROVAL_TIMEOUT_S ||
    requirements.maxTimeoutSeconds > WALLET_MAX_TIMEOUT_S
  ) {
    return { valid: false, reason: `Invalid maxTimeoutSeconds: ${requirements.maxTimeoutSeconds}` }
  }
  if (requirements.payTo === context.walletState.addressRaw) return { valid: false, reason: 'Self-payment not allowed' }
  if (context.isAutoMode && context.originalDomain !== context.finalDomain) {
    return { valid: false, reason: 'Cross-domain redirect in auto mode' }
  }
  return { valid: true }
}

export function resolveAutoPayMode(baseMode: PaymentMode, amountNano: string, perRequestLimit: string): PaymentMode {
  if (baseMode !== 'auto') return baseMode
  const ceiling = perRequestLimit !== '0' ? BigInt(perRequestLimit) : AUTO_PAY_DEFAULT_MAX_PER_REQUEST
  try {
    return BigInt(amountNano) > ceiling ? 'manual' : baseMode
  } catch {
    return 'manual'
  }
}

export function buildPaymentNotification(
  id: string,
  domain: string,
  url: string,
  requirements: Pick<PaymentRequirements, 'amount' | 'payTo'>,
  status: PaymentNotificationData['status'],
  error?: string
): PaymentNotificationData {
  return {
    id,
    domain,
    url,
    amount: requirements.amount,
    payTo: requirements.payTo,
    payToFriendly: rawToFriendly(requirements.payTo),
    status,
    ...(error !== undefined ? { error } : {}),
  }
}
