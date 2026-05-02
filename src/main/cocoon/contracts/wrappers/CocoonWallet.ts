/**
 * VENDORED FROM https://github.com/TelegramMessenger/cocoon-contracts
 * Commit: edafcb2b9a74403ba343e0826772af77ec431277 (2025-12-25)
 * License: see ./LICENSE.upstream
 * DO NOT MODIFY — to update, re-run vendoring procedure documented in VENDORED.md
 */
import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode } from '@ton/core'
import { sign, KeyPair } from '@ton/crypto'

export type CocoonWalletConfig = {
  publicKey: Buffer
  ownerAddress: Address
}

/**
 * Outbound message configuration for external wallet messages
 */
export type OutboundMessage = {
  to: Address
  value: bigint
  body?: Cell
  mode?: number // SendMode, default: 1 (PAY_GAS_SEPARATELY)
  bounce?: boolean // default: true
}

export function cocoonWalletConfigToCell(config: CocoonWalletConfig): Cell {
  return beginCell()
    .storeInt(0, 32) // seqno
    .storeInt(0, 32) // subwallet
    .storeBuffer(config.publicKey, 32)
    .storeUint(0, 32) // status
    .storeAddress(config.ownerAddress)
    .endCell()
}

export class CocoonWallet implements Contract {
  constructor(
    readonly address: Address,
    readonly init?: { code: Cell; data: Cell }
  ) {}

  static createFromAddress(address: Address) {
    return new CocoonWallet(address)
  }

  static createFromConfig(config: CocoonWalletConfig, code: Cell, workchain = 0) {
    const data = cocoonWalletConfigToCell(config)
    const init = { code, data }
    return new CocoonWallet(contractAddress(workchain, init), init)
  }

  async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
    await provider.internal(via, {
      value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell().endCell(),
    })
  }

  static buildForwardMessage(forwardTo: Address, msg: Cell) {
    const fwd_msg: Cell = beginCell()
      .storeUint(0x18, 6)
      .storeAddress(forwardTo)
      .storeCoins(0)
      .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1)
      .storeUint(1, 1)
      .storeRef(msg)
      .endCell()
    return beginCell().storeUint(0x9c69f376, 32).storeInt(0, 64).storeInt(64, 8).storeRef(fwd_msg).endCell()
  }

  async sendForwardMessage(provider: ContractProvider, via: Sender, forwardTo: Address, msg: Cell, value: bigint) {
    await provider.internal(via, {
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: CocoonWallet.buildForwardMessage(forwardTo, msg),
      value: value,
    })
  }

  async getOwnerAddress(provider: ContractProvider): Promise<Address> {
    const result = await provider.get('get_owner_address', [])
    return result.stack.readAddress()
  }

  async getSeqno(provider: ContractProvider): Promise<number> {
    const result = await provider.get('seqno', [])
    return result.stack.readNumber()
  }

  /**
   * Send external message directly via provider
   */
  async sendExternal(provider: ContractProvider, body: Cell) {
    await provider.external(body)
  }

  /**
   * Send signed external message with outbound messages
   */
  async sendExternalSigned(
    provider: ContractProvider,
    messages: OutboundMessage[],
    keyPair: KeyPair,
    opts?: {
      seqno?: number
      subwalletId?: number
      validUntil?: number
    }
  ) {
    const seqno = opts?.seqno !== undefined ? opts.seqno : await this.getSeqno(provider)
    const body = CocoonWallet.createExternalMessage(messages, keyPair, {
      ...opts,
      seqno,
    })
    await provider.external(body)
  }

  // ============================================================
  // External Message Helpers (Static)
  // ============================================================

  /**
   * Build an outbound message cell for use in external messages
   */
  static buildOutboundMessageCell(msg: OutboundMessage): Cell {
    const bounce = msg.bounce ?? true
    const builder = beginCell()
      .storeUint(bounce ? 0x18 : 0x10, 6) // flags: bounce or non-bounce
      .storeAddress(msg.to)
      .storeCoins(msg.value)
      .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1) // empty extra fields: ihr_disabled, bounce, bounced, src, ihr_fee, fwd_fee, created_lt, created_at, init

    if (msg.body) {
      builder.storeUint(1, 1).storeRef(msg.body) // body as ref
    } else {
      builder.storeUint(0, 1) // no body
    }

    return builder.endCell()
  }

  /**
   * Create a signed external message for this wallet
   */
  static createExternalMessage(
    messages: OutboundMessage[],
    keyPair: KeyPair,
    opts?: {
      seqno?: number
      subwalletId?: number
      validUntil?: number
    }
  ): Cell {
    const seqno = opts?.seqno ?? 0
    const subwalletId = opts?.subwalletId ?? 0
    const validUntil = opts?.validUntil ?? Math.floor(Date.now() / 1000) + 3600

    // Build body: subwalletId | validUntil | seqno | [mode | msgRef]*
    let body = beginCell().storeUint(subwalletId, 32).storeUint(validUntil, 32).storeUint(seqno, 32)

    for (const msg of messages) {
      const mode = msg.mode ?? 1 // PAY_GAS_SEPARATELY
      const msgCell = CocoonWallet.buildOutboundMessageCell(msg)
      body = body.storeUint(mode, 8).storeRef(msgCell)
    }

    const bodyCell = body.endCell()
    const signature = sign(bodyCell.hash(), keyPair.secretKey)

    return beginCell().storeBuffer(signature).storeSlice(bodyCell.beginParse()).endCell()
  }
}
