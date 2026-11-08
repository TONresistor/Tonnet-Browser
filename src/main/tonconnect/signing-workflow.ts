import { Address } from '@ton/core'
import { createHash } from 'node:crypto'
import { WalletEngineError, type TransferReview } from '../../wallet-engine'
import { errorMessage } from '../../shared/errors'
import type { TonConnectApprovalPort } from './approval'
import { buildSignDataRows, validateSignDataPayload } from './sign-data-preview'
import { parseTransactionRequest } from './transaction-request'
import { TONCONNECT_ERROR, TON_MAINNET_CHAIN, type AppRequest, type WalletResponse } from './types'
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

  sendTransaction(
    domain: string,
    appName: string,
    expectedAddress: string,
    message: AppRequest,
    sessionId = 0,
    signal?: AbortSignal
  ): Promise<WalletResponse> {
    return this.transfer(false, domain, appName, expectedAddress, message, sessionId, signal)
  }

  signMessage(
    domain: string,
    appName: string,
    expectedAddress: string,
    message: AppRequest,
    sessionId = 0,
    signal?: AbortSignal
  ): Promise<WalletResponse> {
    if (this.wallet.getState().walletVersion !== 'v5R1')
      return Promise.resolve(rpcError(message.id, TONCONNECT_ERROR.METHOD_NOT_SUPPORTED, 'signMessage requires V5R1'))
    return this.transfer(true, domain, appName, expectedAddress, message, sessionId, signal)
  }

  private async transfer(
    signOnly: boolean,
    domain: string,
    appName: string,
    expectedAddress: string,
    message: AppRequest,
    sessionId = 0,
    signal?: AbortSignal
  ): Promise<WalletResponse> {
    const signingSession = this.wallet.getSessionRevision?.()
    const account = this.wallet.getTonConnectAccount()
    const parsed = parseTransactionRequest(message.params?.[0], account?.addressRaw ?? null)
    if (!parsed.ok) return rpcError(message.id, TONCONNECT_ERROR.BAD_REQUEST, parsed.error)

    let messages = parsed.messages
    if (parsed.items) {
      try {
        messages = await this.wallet.resolveTonConnectItems(parsed.items, expectedAddress, signingSession, signal)
      } catch (error) {
        return rpcError(
          message.id,
          signal?.aborted ? TONCONNECT_ERROR.UNKNOWN_APP : TONCONNECT_ERROR.BAD_REQUEST,
          errorMessage(error)
        )
      }
    }
    const totalNano = messages.reduce((sum, item) => sum + BigInt(item.amount), 0n)
    const assetRows =
      parsed.items?.flatMap((item, index) =>
        item.type === 'ton'
          ? []
          : [
              {
                label: `Asset ${index + 1}`,
                value: `${item.type === 'jetton' ? 'Jetton' : 'NFT'} · ${item.type === 'jetton' ? item.master : item.nftAddress}`,
              },
              { label: 'Recipient', value: item.type === 'jetton' ? item.destination : item.newOwner },
              ...(item.type === 'jetton' ? [{ label: 'Amount (base units)', value: item.amount }] : []),
              ...(item.responseDestination ? [{ label: 'Excess funds to', value: item.responseDestination }] : []),
            ]
      ) ?? []

    try {
      const signTransfer = signOnly
        ? this.wallet.signTonConnectMessage.bind(this.wallet)
        : this.wallet.signTonConnectTransaction.bind(this.wallet)
      const boc = await signTransfer(
        messages,
        expectedAddress,
        createHash('sha256')
          .update(JSON.stringify([domain, sessionId, message.id]))
          .digest('hex'),
        parsed.validUntil,
        signingSession,
        async (review: Readonly<TransferReview>) => {
          signal?.throwIfAborted()
          const approved = await this.approval.request(
            {
              type: 'approval',
              iconFallback: '↑',
              title: signOnly ? 'Sign message' : 'Confirm transaction',
              subtitle: appName,
              domain,
              amount: `${formatGram(totalNano.toString())} GRAM`,
              warning: signOnly
                ? 'The site or a relay may submit this signed message later and transfer these assets. This wallet will not broadcast it.'
                : parsed.hasContractPayload
                  ? 'Includes a contract payload — this is not a plain transfer.'
                  : undefined,
              rows: [
                ...assetRows,
                ...review.messages.map((item, index) => ({
                  label: review.messages.length > 1 ? `To ${index + 1}` : 'To',
                  value: `${Address.parse(item.address).toString({ bounceable: item.bounce })} · ${formatGram(item.amount)} GRAM`,
                })),
                ...(!signOnly ? [{ label: 'Estimated fee', value: `~${formatGram(review.estimatedFee)} GRAM` }] : []),
                { label: 'Valid until', value: new Date(review.validUntil * 1000).toISOString() },
              ],
              actions: [
                { id: 'deny', label: 'Reject' },
                { id: 'approve', label: signOnly ? 'Sign' : 'Confirm', primary: true },
              ],
            },
            signal
          )
          signal?.throwIfAborted()
          if (approved && parsed.items) {
            try {
              const current = await this.wallet.resolveTonConnectItems(
                parsed.items,
                expectedAddress,
                signingSession,
                signal
              )
              if (JSON.stringify(current) !== JSON.stringify(messages))
                throw new Error('Asset transfer changed during approval')
            } catch (error) {
              throw new WalletEngineError('INVALID_TRANSFER', errorMessage(error))
            }
          }
          return approved
        },
        signal
      )
      return {
        id: message.id,
        result: signOnly ? { internalBoc: boc } : boc,
      }
    } catch (error) {
      if (signal?.aborted) return rpcError(message.id, TONCONNECT_ERROR.UNKNOWN_APP, 'TON Connect session revoked')
      if (error instanceof WalletEngineError && error.code === 'USER_CANCELLED')
        return rpcError(
          message.id,
          TONCONNECT_ERROR.USER_DECLINED,
          signOnly ? 'Message signing rejected by user' : 'Transaction rejected by user'
        )
      if (error instanceof WalletEngineError && ['INVALID_TRANSFER', 'TRANSFER_EXPIRED'].includes(error.code))
        return rpcError(message.id, TONCONNECT_ERROR.BAD_REQUEST, error.message)
      return rpcError(message.id, TONCONNECT_ERROR.UNKNOWN, errorMessage(error))
    }
  }

  async signData(
    domain: string,
    appName: string,
    expectedAddress: string,
    message: AppRequest,
    signal?: AbortSignal
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
    if (raw.network !== undefined && raw.network !== TON_MAINNET_CHAIN) {
      return rpcError(message.id, TONCONNECT_ERROR.BAD_REQUEST, 'Network mismatch')
    }
    if (raw.from !== undefined) {
      try {
        if (!Address.parse(raw.from).equals(Address.parse(expectedAddress))) throw new Error('Signer mismatch')
      } catch {
        return rpcError(message.id, TONCONNECT_ERROR.BAD_REQUEST, 'Invalid signer address')
      }
    }

    const approved = await this.approval.request(
      {
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
      },
      signal
    )
    if (signal?.aborted) return rpcError(message.id, TONCONNECT_ERROR.UNKNOWN_APP, 'TON Connect session revoked')
    if (!approved) return rpcError(message.id, TONCONNECT_ERROR.USER_DECLINED, 'Sign request rejected by user')

    try {
      return {
        id: message.id,
        result: await this.wallet.signData(domain, raw, expectedAddress, signingSession, signal),
      }
    } catch (error) {
      if (signal?.aborted) return rpcError(message.id, TONCONNECT_ERROR.UNKNOWN_APP, 'TON Connect session revoked')
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
