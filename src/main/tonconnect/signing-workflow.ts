import { Address } from '@ton/core'
import { errorMessage } from '../../shared/errors'
import type { TonConnectApprovalPort } from './approval'
import { buildSignDataRows, validateSignDataPayload } from './sign-data-preview'
import { parseTransactionRequest } from './transaction-request'
import { TONCONNECT_ERROR, type AppRequest, type WalletResponse } from './types'
import type { TonConnectWalletPort } from './wallet-port'

function rpcError(id: string, code: number, message: string): WalletResponse {
  return { id, error: { code, message } }
}

/** Value-moving TonConnect workflows, independent of sessions and Electron UI. */
export class TonConnectSigningWorkflow {
  constructor(
    private readonly wallet: TonConnectWalletPort,
    private readonly approval: TonConnectApprovalPort
  ) {}

  async sendTransaction(
    domain: string,
    appName: string,
    expectedAddress: string,
    message: AppRequest
  ): Promise<WalletResponse> {
    const account = this.wallet.getTonConnectAccount()
    const parsed = parseTransactionRequest(message.params?.[0], account?.addressRaw ?? null)
    if (!parsed.ok) return rpcError(message.id, TONCONNECT_ERROR.BAD_REQUEST, parsed.error)

    const approved = await this.approval.request({
      type: 'approval',
      iconFallback: '↑',
      title: 'Confirm transaction',
      subtitle: appName,
      domain,
      amount: `${formatGram(parsed.totalNano.toString())} GRAM`,
      warning: parsed.hasContractPayload ? 'Includes a contract payload — this is not a plain transfer.' : undefined,
      rows: parsed.messages.map((item, index) => ({
        label: parsed.messages.length > 1 ? `To ${index + 1}` : 'To',
        value: shortAddress(item.address),
      })),
      actions: [
        { id: 'deny', label: 'Reject' },
        { id: 'approve', label: 'Confirm', primary: true },
      ],
    })
    if (!approved) return rpcError(message.id, TONCONNECT_ERROR.USER_DECLINED, 'Transaction rejected by user')

    try {
      return {
        id: message.id,
        result: await this.wallet.signTonConnectTransaction(parsed.messages, expectedAddress),
      }
    } catch (error) {
      return rpcError(message.id, TONCONNECT_ERROR.UNKNOWN, errorMessage(error))
    }
  }

  async signData(
    domain: string,
    appName: string,
    expectedAddress: string,
    message: AppRequest
  ): Promise<WalletResponse> {
    let raw: unknown
    try {
      raw = JSON.parse(message.params?.[0] ?? '')
    } catch {
      return rpcError(message.id, TONCONNECT_ERROR.BAD_REQUEST, 'Invalid sign-data payload')
    }
    if (!validateSignDataPayload(raw)) {
      return rpcError(message.id, TONCONNECT_ERROR.BAD_REQUEST, 'Invalid or unsupported sign-data payload')
    }

    const approved = await this.approval.request({
      type: 'approval',
      iconFallback: '✎',
      title: 'Sign data',
      subtitle: appName,
      domain,
      rows: buildSignDataRows(raw),
      actions: [
        { id: 'deny', label: 'Reject' },
        { id: 'approve', label: 'Sign', primary: true },
      ],
    })
    if (!approved) return rpcError(message.id, TONCONNECT_ERROR.USER_DECLINED, 'Sign request rejected by user')

    try {
      return { id: message.id, result: await this.wallet.signData(domain, raw, expectedAddress) }
    } catch (error) {
      return rpcError(message.id, TONCONNECT_ERROR.UNKNOWN, errorMessage(error))
    }
  }
}

function shortAddress(value: string): string {
  let normalized = value
  try {
    normalized = Address.parse(value).toString({ bounceable: false })
  } catch {
    // Keep the already validated input for presentation.
  }
  return normalized.length > 14 ? `${normalized.slice(0, 6)}…${normalized.slice(-4)}` : normalized
}

function formatGram(nano: string): string {
  const amount = BigInt(nano)
  const whole = amount / 1_000_000_000n
  const fraction = (amount % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : `${whole}`
}
