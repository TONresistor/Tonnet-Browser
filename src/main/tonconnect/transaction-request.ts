import { Address, Cell } from '@ton/core'
import { TONCONNECT_MAX_MESSAGES, type TonConnectOutMessage } from './types'
import { checkFromAndNetwork } from './request-scope'

interface RawSendMessage {
  address?: unknown
  amount?: unknown
  payload?: unknown
  stateInit?: unknown
}

export type ParsedTransactionRequest =
  | { ok: false; error: string }
  | { ok: true; messages: TonConnectOutMessage[]; totalNano: bigint; hasContractPayload: boolean }

/** Pure decode and validation boundary for TonConnect sendTransaction params. */
export function parseTransactionRequest(
  encoded: string | undefined,
  accountAddress: string | null,
  nowSec = Math.floor(Date.now() / 1000)
): ParsedTransactionRequest {
  let parsed: { network?: string; from?: string; valid_until?: number; messages?: RawSendMessage[] }
  try {
    parsed = JSON.parse(encoded ?? '')
  } catch {
    return { ok: false, error: 'Invalid transaction payload' }
  }

  if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) return { ok: false, error: 'No messages' }
  if (parsed.messages.length > TONCONNECT_MAX_MESSAGES) return { ok: false, error: 'Too many messages' }
  const scopeError = checkFromAndNetwork(parsed, accountAddress)
  if (scopeError) return { ok: false, error: scopeError }
  if (parsed.valid_until && parsed.valid_until < nowSec) return { ok: false, error: 'Transaction expired' }

  const messages: TonConnectOutMessage[] = []
  for (const message of parsed.messages) {
    if (typeof message.address !== 'string' || !isFriendlyAddress(message.address)) {
      return { ok: false, error: 'Address must be user-friendly' }
    }
    if (typeof message.amount !== 'string' || !/^[0-9]+$/.test(message.amount)) {
      return { ok: false, error: 'Amount must be a string of nanocoins' }
    }
    if (message.payload !== undefined && (typeof message.payload !== 'string' || !isValidBoc(message.payload))) {
      return { ok: false, error: 'Invalid payload BoC' }
    }
    if (message.stateInit !== undefined && (typeof message.stateInit !== 'string' || !isValidBoc(message.stateInit))) {
      return { ok: false, error: 'Invalid stateInit BoC' }
    }
    messages.push({
      address: message.address,
      amount: message.amount,
      payload: typeof message.payload === 'string' ? message.payload : undefined,
      stateInit: typeof message.stateInit === 'string' ? message.stateInit : undefined,
    })
  }

  return {
    ok: true,
    messages,
    totalNano: messages.reduce((total, message) => total + BigInt(message.amount), 0n),
    hasContractPayload: messages.some((message) => Boolean(message.payload || message.stateInit)),
  }
}

function isFriendlyAddress(value: string): boolean {
  try {
    Address.parseFriendly(value)
    return true
  } catch {
    return false
  }
}

function isValidBoc(value: string): boolean {
  try {
    Cell.fromBase64(value)
    return true
  } catch {
    return false
  }
}
