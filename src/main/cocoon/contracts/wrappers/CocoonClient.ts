/**
 * VENDORED FROM https://github.com/TelegramMessenger/cocoon-contracts
 * Commit: edafcb2b9a74403ba343e0826772af77ec431277 (2025-12-25)
 * License: see ./LICENSE.upstream
 * DO NOT MODIFY — to update, re-run vendoring procedure documented in VENDORED.md
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode } from '@ton/core'
import { sign } from '@ton/crypto'

// Opcodes (exported for tests)
export const OP_CHARGE_SIGNED = 0xbb63ff93
export const OP_GRANT_REFUND_SIGNED = 0xefd711e1

export type CocoonClientConfig = {
  ownerAddress: Address
  proxyAddress: Address
  proxyPublicKey: bigint
  state: number
  balance: bigint
  stake: bigint
  tokensUsed: bigint
  unlockTs: number
  secretHash: bigint
  params: Cell
}

export function cocoonClientConfigToCell(config: CocoonClientConfig): Cell {
  const constData = beginCell()
    .storeAddress(config.ownerAddress)
    .storeAddress(config.proxyAddress)
    .storeUint(config.proxyPublicKey, 256)
    .endCell()

  return beginCell()
    .storeUint(config.state, 2)
    .storeCoins(config.balance)
    .storeCoins(config.stake)
    .storeUint(config.tokensUsed, 64)
    .storeUint(config.unlockTs, 32)
    .storeUint(config.secretHash, 256)
    .storeRef(constData)
    .storeRef(config.params)
    .endCell()
}

export class CocoonClient implements Contract {
  constructor(
    readonly address: Address,
    readonly init?: { code: Cell; data: Cell }
  ) {}

  static createFromAddress(address: Address) {
    return new CocoonClient(address)
  }

  static createFromConfig(config: CocoonClientConfig, code: Cell, workchain = 0) {
    const data = cocoonClientConfigToCell(config)
    const init = { code, data }
    return new CocoonClient(contractAddress(workchain, init), init)
  }

  async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
    await provider.internal(via, {
      value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell().endCell(),
    })
  }

  async getData(provider: ContractProvider) {
    const result = await provider.get('get_cocoon_client_data', [])
    return {
      ownerAddress: result.stack.readAddress(),
      proxyAddress: result.stack.readAddress(),
      proxyPublicKey: result.stack.readBigNumber(),
      state: result.stack.readNumber(),
      balance: result.stack.readBigNumber(),
      stake: result.stack.readBigNumber(),
      tokensUsed: result.stack.readBigNumber(),
      unlockTs: result.stack.readNumber(),
      secretHash: result.stack.readBigNumber(),
    }
  }

  async sendExtTopUp(
    provider: ContractProvider,
    via: Sender,
    value: bigint,
    topUpAmount: bigint,
    sendExcessesTo: Address
  ) {
    return await provider.internal(via, {
      value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell()
        .storeUint(0xf172e6c2, 32) // op::ext_client_top_up
        .storeUint(0, 64) // query_id
        .storeCoins(topUpAmount)
        .storeAddress(sendExcessesTo)
        .endCell(),
    })
  }

  async sendOwnerChangeSecretHashAndTopUp(
    provider: ContractProvider,
    via: Sender,
    value: bigint,
    topUpAmount: bigint,
    newSecretHash: bigint,
    sendExcessesTo: Address
  ) {
    return await provider.internal(via, {
      value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell()
        .storeUint(0x8473b408, 32) // op::owner_client_change_secret_hash_and_top_up
        .storeUint(0, 64) // query_id
        .storeCoins(topUpAmount)
        .storeUint(newSecretHash, 256)
        .storeAddress(sendExcessesTo)
        .endCell(),
    })
  }

  async sendOwnerRegister(
    provider: ContractProvider,
    via: Sender,
    value: bigint,
    nonce: bigint,
    sendExcessesTo: Address
  ) {
    return await provider.internal(via, {
      value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell()
        .storeUint(0xc45f9f3b, 32) // op::owner_client_register
        .storeUint(0, 64) // query_id
        .storeUint(nonce, 64)
        .storeAddress(sendExcessesTo)
        .endCell(),
    })
  }

  async sendOwnerChangeSecretHash(
    provider: ContractProvider,
    via: Sender,
    value: bigint,
    newSecretHash: bigint,
    sendExcessesTo: Address
  ) {
    return await provider.internal(via, {
      value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell()
        .storeUint(0xa9357034, 32) // op::owner_client_change_secret_hash
        .storeUint(0, 64) // query_id
        .storeUint(newSecretHash, 256)
        .storeAddress(sendExcessesTo)
        .endCell(),
    })
  }

  async sendOwnerIncreaseStake(
    provider: ContractProvider,
    via: Sender,
    value: bigint,
    newStake: bigint,
    sendExcessesTo: Address
  ) {
    return await provider.internal(via, {
      value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell()
        .storeUint(0x6a1f6a60, 32) // op::owner_client_increase_stake
        .storeUint(0, 64) // query_id
        .storeCoins(newStake)
        .storeAddress(sendExcessesTo)
        .endCell(),
    })
  }

  async sendOwnerWithdraw(provider: ContractProvider, via: Sender, value: bigint, sendExcessesTo: Address) {
    return await provider.internal(via, {
      value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell()
        .storeUint(0xda068e78, 32) // op::owner_client_withdraw
        .storeUint(0, 64) // query_id
        .storeAddress(sendExcessesTo)
        .endCell(),
    })
  }

  async sendOwnerRequestRefund(provider: ContractProvider, via: Sender, value: bigint, sendExcessesTo: Address) {
    return await provider.internal(via, {
      value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell()
        .storeUint(0xfafa6cc1, 32) // op::owner_client_request_refund
        .storeUint(0, 64) // query_id
        .storeAddress(sendExcessesTo)
        .endCell(),
    })
  }

  async sendExtChargeSigned(
    provider: ContractProvider,
    via: Sender,
    value: bigint,
    queryId: number,
    signature: Buffer,
    signedPayload: Cell,
    sendExcessesTo: Address
  ) {
    return await provider.internal(via, {
      value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell()
        .storeUint(OP_CHARGE_SIGNED, 32)
        .storeUint(queryId, 64)
        .storeAddress(sendExcessesTo)
        .storeBuffer(signature)
        .storeRef(signedPayload)
        .endCell(),
    })
  }

  async sendExtGrantRefundSigned(
    provider: ContractProvider,
    via: Sender,
    value: bigint,
    queryId: number,
    signature: Buffer,
    signedPayload: Cell,
    sendExcessesTo: Address
  ) {
    return await provider.internal(via, {
      value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell()
        .storeUint(OP_GRANT_REFUND_SIGNED, 32)
        .storeUint(queryId, 64)
        .storeAddress(sendExcessesTo)
        .storeBuffer(signature)
        .storeRef(signedPayload)
        .endCell(),
    })
  }

  // Convenience methods that handle signing internally
  async sendChargeRequest(
    provider: ContractProvider,
    via: Sender,
    queryId: number,
    newTokensUsed: bigint,
    expectedMyAddress: Address,
    sendExcessesTo: Address,
    keyPair: any, // KeyPair from @ton/crypto
    value: bigint
  ) {
    const signedPayload = beginCell()
      .storeUint(OP_CHARGE_SIGNED, 32)
      .storeUint(queryId, 64)
      .storeUint(newTokensUsed, 64)
      .storeAddress(expectedMyAddress)
      .endCell()

    const signature = sign(signedPayload.hash(), keyPair.secretKey)

    return this.sendExtChargeSigned(provider, via, value, queryId, signature, signedPayload, sendExcessesTo)
  }

  async sendGrantRefundRequest(
    provider: ContractProvider,
    via: Sender,
    queryId: number,
    newTokensUsed: bigint,
    expectedMyAddress: Address,
    sendExcessesTo: Address,
    keyPair: any, // KeyPair from @ton/crypto
    value: bigint
  ) {
    const signedPayload = beginCell()
      .storeUint(OP_GRANT_REFUND_SIGNED, 32)
      .storeUint(queryId, 64)
      .storeUint(newTokensUsed, 64)
      .storeAddress(expectedMyAddress)
      .endCell()

    const signature = sign(signedPayload.hash(), keyPair.secretKey)

    return this.sendExtGrantRefundSigned(provider, via, value, queryId, signature, signedPayload, sendExcessesTo)
  }
}
