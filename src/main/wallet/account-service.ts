import { Address, beginCell, storeStateInit } from '@ton/core'
import type { WalletContractV5R1 } from '@ton/ton'
import type { TonConnectAccount } from '../tonconnect/wallet-port'

export interface WalletAccountContext {
  getPublicKey(): Buffer | null
  getContract(): WalletContractV5R1 | null
}

/** Read-only address/public-key/state derivation owned independently from signing. */
export class WalletAccountService {
  constructor(private readonly context: WalletAccountContext) {}

  getTonConnectAccount(): TonConnectAccount | null {
    const publicKey = this.context.getPublicKey()
    const contract = this.context.getContract()
    if (!publicKey || !contract) return null
    const stateInit = beginCell().store(storeStateInit(contract.init)).endCell()
    return {
      addressRaw: contract.address.toRawString(),
      publicKey: publicKey.toString('hex'),
      walletStateInit: stateInit.toBoc().toString('base64'),
    }
  }

  assertTonConnectAccount(expectedAddress?: string): void {
    if (!expectedAddress) return
    const contract = this.context.getContract()
    if (!contract || Address.parse(expectedAddress).toRawString() !== contract.address.toRawString()) {
      throw new Error('Wallet changed while approval was pending')
    }
  }
}
