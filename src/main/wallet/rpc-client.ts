/**
 * TON RPC client.
 * Communicates with the TON blockchain via toncenter through the local proxy.
 * Includes retry with exponential backoff for rate-limited (429) requests.
 */

import { TonClient, WalletContractV5R1 } from '@ton/ton'
import { Address } from '@ton/core'
import { createLogger } from '../../shared/logger'
const log = createLogger('wallet:rpc')

const MAX_RETRIES = 3
const BASE_DELAY_MS = 2000

export async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (error: any) {
      const is429 = error?.status === 429 || error?.response?.status === 429 || String(error?.message).includes('429')
      if (is429 && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt)
        log.warn(`${label}: rate limited (429), retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`)
        await new Promise((r) => setTimeout(r, delay))
        continue
      }
      throw error
    }
  }
  throw new Error(`${label}: max retries exceeded`)
}

export class TonRpcClient {
  private client: TonClient

  constructor(_proxyPort: number, apiKey?: string) {
    // TonClient uses axios internally. Node.js HTTP requests from the main process
    // resolve DNS independently of Chromium's host-resolver-rules, so toncenter.com
    // is reachable directly. The proxy is only needed for browser tab requests.
    this.client = new TonClient({
      endpoint: 'https://toncenter.com/api/v2/jsonRPC',
      apiKey: apiKey || undefined,
    })
  }

  /**
   * Get the balance of an address in nanoTON.
   */
  async getBalance(address: string): Promise<string> {
    return withRetry(async () => {
      const balance = await this.client.getBalance(Address.parse(address))
      return balance.toString()
    }, 'getBalance')
  }

  /**
   * Get the current seqno of a W5 wallet contract.
   * Returns 0 for uninitialized wallets (exit_code -13, -256, or "Unable to execute").
   */
  async getSeqno(publicKey: Buffer): Promise<number> {
    return withRetry(async () => {
      try {
        const wallet = WalletContractV5R1.create({ publicKey, workchain: 0 })
        const contract = this.client.open(wallet)
        return await contract.getSeqno()
      } catch (error: any) {
        const msg = String(error?.message || error)
        if (msg.includes('-13') || msg.includes('-256') || msg.includes('Unable to execute')) {
          log.info('Wallet not deployed yet, seqno=0')
          return 0
        }
        throw error
      }
    }, 'getSeqno')
  }

  /**
   * Fetch on-chain transactions for an address.
   */
  async getTransactions(address: string, limit: number = 20): Promise<any[]> {
    return withRetry(async () => {
      const addr = Address.parse(address)
      const transactions = await this.client.getTransactions(addr, { limit })
      return transactions
    }, 'getTransactions')
  }

  getClient(): TonClient {
    return this.client
  }

  /**
   * Broadcast a signed BOC to the network.
   */
  async broadcast(boc: Buffer): Promise<void> {
    return withRetry(async () => {
      await this.client.sendFile(boc)
      log.info('Transaction broadcast successful')
    }, 'broadcast')
  }
}
