import { Address } from '@ton/core'
import { createHash } from 'node:crypto'
import { WalletEngineError } from '../../wallet-engine'
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
    message: AppRequest,
    sessionId = 0
  ): Promise<WalletResponse> {
    const signingSession = this.wallet.getSessionRevision?.()
    const account = this.wallet.getTonConnectAccount()
    const parsed = parseTransactionRequest(message.params?.[0], account?.addressRaw ?? null)
    if (!parsed.ok) return rpcError(message.id, TONCONNECT_ERROR.BAD_REQUEST, parsed.error)

    try {
      return {
        id: message.id,
        result: await this.wallet.signTonConnectTransaction(
          parsed.messages,
          expectedAddress,
          createHash('sha256')
            .update(JSON.stringify([domain, sessionId, message.id]))
            .digest('hex'),
          parsed.validUntil,
          signingSession,
          async (review) =>
            this.approval.request({
              type: 'approval',
              iconFallback: '↑',
              title: 'Confirm transaction',
              subtitle: appName,
              domain,
              amount: `${formatGram(parsed.totalNano.toString())} GRAM`,
              warning: parsed.hasContractPayload
                ? 'Includes a contract payload — this is not a plain transfer.'
                : undefined,
              rows: [
                ...review.messages.map((item, index) => ({
                  label: review.messages.length > 1 ? `To ${index + 1}` : 'To',
                  value: `${Address.parse(item.address).toString({ bounceable: item.bounce })} · ${formatGram(item.amount)} GRAM`,
                })),
                { label: 'Estimated fee', value: `~${formatGram(review.estimatedFee)} GRAM` },
                { label: 'Valid until', value: new Date(review.validUntil * 1000).toISOString() },
              ],
              actions: [
                { id: 'deny', label: 'Reject' },
                { id: 'approve', label: 'Confirm', primary: true },
              ],
            })
        ),
      }
    } catch (error) {
      if (error instanceof WalletEngineError && error.code === 'USER_CANCELLED')
        return rpcError(message.id, TONCONNECT_ERROR.USER_DECLINED, 'Transaction rejected by user')
      return rpcError(message.id, TONCONNECT_ERROR.UNKNOWN, errorMessage(error))
    }
  }

  async signData(
    domain: string,
    appName: string,
    expectedAddress: string,
    message: AppRequest
  ): Promise<WalletResponse> {
    const signingSession = this.wallet.getSessionRevision?.()
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
      return { id: message.id, result: await this.wallet.signData(domain, raw, expectedAddress, signingSession) }
    } catch (error) {
      return rpcError(message.id, TONCONNECT_ERROR.UNKNOWN, errorMessage(error))
    }
  }
}

function formatGram(nano: string): string {
  const amount = BigInt(nano)
  const whole = amount / 1_000_000_000n
  const fraction = (amount % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : `${whole}`
}
