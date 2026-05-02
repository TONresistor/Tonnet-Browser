/**
 * VENDORED FROM https://github.com/TelegramMessenger/cocoon-contracts
 * Commit: edafcb2b9a74403ba343e0826772af77ec431277 (2025-12-25)
 * License: see ./LICENSE.upstream
 * DO NOT MODIFY — to update, re-run vendoring procedure documented in VENDORED.md
 */
/* eslint-disable @typescript-eslint/no-wrapper-object-types, @typescript-eslint/no-unused-vars, prefer-const */
import {
  Address,
  beginCell,
  Cell,
  Builder,
  Contract,
  contractAddress,
  ContractProvider,
  Sender,
  SendMode,
  Slice,
  Dictionary,
  BitString,
} from '@ton/core'
import { toNano } from '@ton/core'

export type ProxyInfo = {
  addr: String
}

export function createProxyInfoValue() {
  return {
    serialize: (src: ProxyInfo, builder: Builder) => {
      builder.storeBit(false)
      builder.storeUint(src.addr.length, 7)
      builder.storeBuffer(Buffer.from(src.addr, 'utf8'))
    },
    parse: (src: Slice) => {
      const value = src.loadBit()
      const strlen = src.loadUint(7)
      const buf = src.loadBuffer(strlen)
      const str = buf.toString()
      //src.endParse();
      const res: ProxyInfo = {
        addr: str,
      }
      return res
    },
  }
}

export type PublicKeyInfo = {
  type: number
  expire_at: number
}

export function createPublicKeyInfoValue() {
  return {
    serialize: (src: PublicKeyInfo, builder: Builder) => {
      builder.storeUint(src.type, 8)
      builder.storeUint(src.expire_at, 32)
    },
    parse: (src: Slice) => {
      const type = src.loadUint(8)
      const expire_at = src.loadUint(32)
      //src.endParse();
      const res: PublicKeyInfo = {
        type: type,
        expire_at: expire_at,
      }
      return res
    },
  }
}

export type CocoonParams = {
  struct_version: number
  params_version: number
  unique_id: number
  is_test: boolean
  price_per_token: bigint
  worker_fee_per_token: bigint
  prompt_tokens_price_multiplier: number
  cached_tokens_price_multiplier: number
  completion_tokens_price_multiplier: number
  reasoning_tokens_price_multiplier: number
  proxy_delay_before_close: number
  client_delay_before_close: number
  min_proxy_stake: bigint
  min_client_stake: bigint
  proxy_sc_code: Cell | null
  worker_sc_code: Cell | null
  client_sc_code: Cell | null
}

export function cocoonParamsToCell(params: CocoonParams): Cell {
  if (params.struct_version == 1) {
    return beginCell()
      .storeUint(1, 8)
      .storeUint(params.params_version, 32)
      .storeUint(params.unique_id, 32)
      .storeBit(params.is_test)
      .storeCoins(params.price_per_token)
      .storeCoins(params.worker_fee_per_token)
      .storeUint(params.proxy_delay_before_close, 32)
      .storeUint(params.client_delay_before_close, 32)
      .storeCoins(params.min_proxy_stake)
      .storeCoins(params.min_client_stake)
      .storeMaybeRef(params.proxy_sc_code)
      .storeMaybeRef(params.worker_sc_code)
      .storeMaybeRef(params.client_sc_code)
      .endCell()
  } else if (params.struct_version == 2) {
    return beginCell()
      .storeUint(2, 8)
      .storeUint(params.params_version, 32)
      .storeUint(params.unique_id, 32)
      .storeBit(params.is_test)
      .storeCoins(params.price_per_token)
      .storeCoins(params.worker_fee_per_token)
      .storeUint(params.cached_tokens_price_multiplier, 32)
      .storeUint(params.reasoning_tokens_price_multiplier, 32)
      .storeUint(params.proxy_delay_before_close, 32)
      .storeUint(params.client_delay_before_close, 32)
      .storeCoins(params.min_proxy_stake)
      .storeCoins(params.min_client_stake)
      .storeMaybeRef(params.proxy_sc_code)
      .storeMaybeRef(params.worker_sc_code)
      .storeMaybeRef(params.client_sc_code)
      .endCell()
  } else if (params.struct_version == 3 || params.struct_version == 4) {
    return beginCell()
      .storeUint(params.struct_version, 8)
      .storeUint(params.params_version, 32)
      .storeUint(params.unique_id, 32)
      .storeBit(params.is_test)
      .storeCoins(params.price_per_token)
      .storeCoins(params.worker_fee_per_token)
      .storeUint(params.prompt_tokens_price_multiplier, 32)
      .storeUint(params.cached_tokens_price_multiplier, 32)
      .storeUint(params.completion_tokens_price_multiplier, 32)
      .storeUint(params.reasoning_tokens_price_multiplier, 32)
      .storeUint(params.proxy_delay_before_close, 32)
      .storeUint(params.client_delay_before_close, 32)
      .storeCoins(params.min_proxy_stake)
      .storeCoins(params.min_client_stake)
      .storeMaybeRef(params.proxy_sc_code)
      .storeMaybeRef(params.worker_sc_code)
      .storeMaybeRef(params.client_sc_code)
      .endCell()
  } else {
    throw new Error('unknown param type')
  }
}

export type CocoonRootConfig = {
  owner_address: Address
  proxy_hashes: Dictionary<bigint, BitString>
  registered_proxies: Dictionary<number, ProxyInfo>
  last_proxy_seqno: number
  worker_hashes: Dictionary<bigint, BitString>
  model_hashes: Dictionary<bigint, BitString>
  version: number
  params: CocoonParams
  public_keys: Dictionary<bigint, PublicKeyInfo>
  key_manager_public_key: bigint
  key_manager_image_hash: bigint
  key_manager_net_addr: ProxyInfo
}

export function cocoonRootConfigToCell(config: CocoonRootConfig): Cell {
  const data = beginCell()
    .storeDict(config.proxy_hashes)
    .storeDict(config.registered_proxies)
    .storeUint(config.last_proxy_seqno, 32)
    .storeDict(config.worker_hashes)
    .storeDict(config.model_hashes)
    .endCell()

  const paramsCell = cocoonParamsToCell(config.params)

  if (config.params.struct_version <= 3) {
    return beginCell()
      .storeAddress(config.owner_address)
      .storeUint(config.version, 32)
      .storeRef(data)
      .storeRef(paramsCell)
      .endCell()
  } else {
    const builder = beginCell()
      .storeDict(config.public_keys)
      .storeUint(config.key_manager_public_key, 256)
      .storeUint(config.key_manager_image_hash, 256)
    createProxyInfoValue().serialize(config.key_manager_net_addr, builder)
    const keyManagerCell = builder.endCell()
    return beginCell()
      .storeAddress(config.owner_address)
      .storeUint(config.version, 32)
      .storeRef(data)
      .storeRef(paramsCell)
      .storeRef(keyManagerCell)
      .endCell()
  }
}

export class CocoonRoot implements Contract {
  constructor(
    readonly address: Address,
    readonly init?: { code: Cell; data: Cell }
  ) {}

  static createFromAddress(address: Address) {
    return new CocoonRoot(address)
  }

  static createFromConfig(config: CocoonRootConfig, code: Cell, workchain = 0) {
    const data = cocoonRootConfigToCell(config)
    const init = { code, data }
    return new CocoonRoot(contractAddress(workchain, init), init)
  }

  async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
    await provider.internal(via, {
      value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell().endCell(),
    })
  }

  static addProxyTypeMessage(proxyHash: Buffer) {
    return beginCell().storeUint(0x71860e80, 32).storeInt(0, 64).storeBuffer(proxyHash, 32).endCell()
  }

  async sendAddProxyType(provider: ContractProvider, via: Sender, proxyHash: Buffer) {
    await provider.internal(via, {
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: CocoonRoot.addProxyTypeMessage(proxyHash),
      value: toNano('0.01'),
    })
  }

  static delProxyTypeMessage(proxyHash: Buffer) {
    return beginCell().storeUint(0x3c41d0b2, 32).storeInt(0, 64).storeBuffer(proxyHash, 32).endCell()
  }

  async sendDelProxyType(provider: ContractProvider, via: Sender, proxyHash: Buffer) {
    await provider.internal(via, {
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: CocoonRoot.delProxyTypeMessage(proxyHash),
      value: toNano('0.01'),
    })
  }

  static addWorkerTypeMessage(workerHash: Buffer) {
    return beginCell().storeUint(0xe34b1c60, 32).storeInt(0, 64).storeBuffer(workerHash, 32).endCell()
  }

  async sendAddWorkerType(provider: ContractProvider, via: Sender, workerHash: Buffer) {
    await provider.internal(via, {
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: CocoonRoot.addWorkerTypeMessage(workerHash),
      value: toNano('0.01'),
    })
  }

  static delWorkerTypeMessage(workerHash: Buffer) {
    return beginCell().storeUint(0x8d94a79a, 32).storeInt(0, 64).storeBuffer(workerHash, 32).endCell()
  }

  async sendDelWorkerType(provider: ContractProvider, via: Sender, workerHash: Buffer) {
    await provider.internal(via, {
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: CocoonRoot.delWorkerTypeMessage(workerHash),
      value: toNano('0.01'),
    })
  }

  static addModelTypeMessage(modelHash: Buffer) {
    return beginCell().storeUint(0xc146134d, 32).storeInt(0, 64).storeBuffer(modelHash, 32).endCell()
  }

  async sendAddModelType(provider: ContractProvider, via: Sender, modelHash: Buffer) {
    await provider.internal(via, {
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: CocoonRoot.addModelTypeMessage(modelHash),
      value: toNano('0.01'),
    })
  }

  static delModelTypeMessage(modelHash: Buffer) {
    return beginCell().storeUint(0x92b11c18, 32).storeInt(0, 64).storeBuffer(modelHash, 32).endCell()
  }

  async sendDelModelType(provider: ContractProvider, via: Sender, modelHash: Buffer) {
    await provider.internal(via, {
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: CocoonRoot.delModelTypeMessage(modelHash),
      value: toNano('0.01'),
    })
  }

  static addProxyInfoMessage(proxyAddress: string) {
    return beginCell()
      .storeUint(0x927c7cb5, 32)
      .storeInt(0, 64)
      .storeInt(0, 1) // type
      .storeUint(proxyAddress.length, 7) // add length
      .storeStringTail(proxyAddress)
      .endCell()
  }

  async sendAddProxyInfo(provider: ContractProvider, via: Sender, proxyAddress: string) {
    await provider.internal(via, {
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: CocoonRoot.addProxyInfoMessage(proxyAddress),
      value: toNano('0.01'),
    })
  }

  static delProxyInfoMessage(proxySeqno: number) {
    return beginCell().storeUint(0x6d49eaf2, 32).storeInt(0, 64).storeInt(proxySeqno, 32).endCell()
  }

  async sendDelProxyInfo(provider: ContractProvider, via: Sender, proxySeqno: number) {
    await provider.internal(via, {
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: CocoonRoot.delProxyInfoMessage(proxySeqno),
      value: toNano('0.01'),
    })
  }

  static updateProxyInfoMessage(proxySeqno: number, proxyAddress: string) {
    return beginCell()
      .storeUint(0x9c7924ba, 32)
      .storeInt(0, 64)
      .storeUint(proxySeqno, 32)
      .storeInt(0, 1) // type
      .storeUint(proxyAddress.length, 7) // add length
      .storeStringTail(proxyAddress)
      .endCell()
  }

  async sendUpdateProxyInfo(provider: ContractProvider, via: Sender, proxySeqno: number, proxyAddress: string) {
    await provider.internal(via, {
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: CocoonRoot.updateProxyInfoMessage(proxySeqno, proxyAddress),
      value: toNano('0.01'),
    })
  }

  static addPublicKeyMessage(publicKey: Buffer, keyType: number, expireAt: number) {
    return beginCell()
      .storeUint(0x6e5a646a, 32)
      .storeInt(0, 64)
      .storeBuffer(publicKey, 32)
      .storeUint(keyType, 8)
      .storeUint(expireAt, 32)
      .endCell()
  }

  async sendAddPublicKey(
    provider: ContractProvider,
    via: Sender,
    publicKey: Buffer,
    keyType: number,
    expireAt: number
  ) {
    await provider.internal(via, {
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: CocoonRoot.addPublicKeyMessage(publicKey, keyType, expireAt),
      value: toNano('0.01'),
    })
  }

  static updateCodeMessage(newCode: Cell) {
    return beginCell().storeUint(0x11aefd51, 32).storeInt(0, 64).storeRef(newCode).endCell()
  }

  async sendUpdateCode(provider: ContractProvider, via: Sender, newCode: Cell) {
    await provider.internal(via, {
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: CocoonRoot.updateCodeMessage(newCode),
      value: toNano('0.01'),
    })
  }

  static updateContractsMessage(proxy: Cell, worker: Cell, client: Cell) {
    return beginCell()
      .storeUint(0xa2370f61, 32)
      .storeInt(0, 64)
      .storeRef(proxy)
      .storeRef(worker)
      .storeRef(client)
      .endCell()
  }

  async sendUpdateContracts(provider: ContractProvider, via: Sender, proxy: Cell, worker: Cell, client: Cell) {
    await provider.internal(via, {
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: CocoonRoot.updateContractsMessage(proxy, worker, client),
      value: toNano('0.01'),
    })
  }

  static changeFeesMessage(pricePerToken: bigint, workerFeePerToken: bigint) {
    return beginCell()
      .storeUint(0xc52ed8d4, 32)
      .storeInt(0, 64)
      .storeCoins(pricePerToken)
      .storeCoins(workerFeePerToken)
      .endCell()
  }

  async sendChangeFees(provider: ContractProvider, via: Sender, pricePerToken: bigint, workerFeePerToken: bigint) {
    await provider.internal(via, {
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: CocoonRoot.changeFeesMessage(pricePerToken, workerFeePerToken),
      value: toNano('0.01'),
    })
  }

  static changeParamsMessage(
    pricePerToken: bigint,
    workerFeePerToken: bigint,
    proxyDelayBeforeClose: number,
    clientDelayBeforeClose: number,
    minProxyStake: bigint,
    minClientStake: bigint
  ) {
    return beginCell()
      .storeUint(0x022fa189, 32)
      .storeInt(0, 64)
      .storeCoins(pricePerToken)
      .storeCoins(workerFeePerToken)
      .storeUint(proxyDelayBeforeClose, 32)
      .storeUint(clientDelayBeforeClose, 32)
      .storeCoins(minProxyStake)
      .storeCoins(minClientStake)
      .endCell()
  }

  async sendChangeParams(
    provider: ContractProvider,
    via: Sender,
    pricePerToken: bigint,
    workerFeePerToken: bigint,
    proxyDelayBeforeClose: number,
    clientDelayBeforeClose: number,
    minProxyStake: bigint,
    minClientStake: bigint
  ) {
    await provider.internal(via, {
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: CocoonRoot.changeParamsMessage(
        pricePerToken,
        workerFeePerToken,
        proxyDelayBeforeClose,
        clientDelayBeforeClose,
        minProxyStake,
        minClientStake
      ),
      value: toNano('0.01'),
    })
  }

  static changeOwnerMessage(newOwner: Address) {
    return beginCell().storeUint(0xc4a1ae54, 32).storeInt(0, 64).storeAddress(newOwner).endCell()
  }

  async sendChangeOwner(provider: ContractProvider, via: Sender, newOwner: Address) {
    await provider.internal(via, {
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: CocoonRoot.changeOwnerMessage(newOwner),
      value: toNano('0.01'),
    })
  }

  static changeKeyManagerMessage(newPublicKey: Buffer, newImageHash: Buffer, newAddress: ProxyInfo) {
    let c = beginCell()
      .storeUint(0xb01c0fe9, 32)
      .storeInt(0, 64)
      .storeBuffer(newPublicKey, 32)
      .storeBuffer(newImageHash, 32)

    createProxyInfoValue().serialize(newAddress, c)

    return c.endCell()
  }

  async sendChangeKeyManager(
    provider: ContractProvider,
    via: Sender,
    newPublicKey: Buffer,
    newImageHash: Buffer,
    newAddress: ProxyInfo
  ) {
    await provider.internal(via, {
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: CocoonRoot.changeKeyManagerMessage(newPublicKey, newImageHash, newAddress),
      value: toNano('0.01'),
    })
  }

  static resetMessage() {
    return beginCell().storeUint(0x563c1d96, 32).storeInt(0, 64).endCell()
  }

  async sendReset(provider: ContractProvider, via: Sender) {
    await provider.internal(via, {
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: CocoonRoot.resetMessage(),
      value: toNano('0.01'),
    })
  }

  static upgradeFullMessage(newData: Cell, newCode: Cell) {
    return beginCell().storeUint(0x4f7c5789, 32).storeInt(0, 64).storeRef(newData).storeRef(newCode).endCell()
  }

  async sendUpgradeFull(provider: ContractProvider, via: Sender, newData: CocoonRootConfig, newCode: Cell) {
    await provider.internal(via, {
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: CocoonRoot.upgradeFullMessage(cocoonRootConfigToCell(newData), newCode),
      value: toNano('0.01'),
    })
  }

  static createDataCell(config: CocoonRootConfig): Cell {
    return cocoonRootConfigToCell(config)
  }

  async getLastProxySeqno(provider: ContractProvider) {
    let res = await provider.get('last_proxy_seqno', [])
    return res.stack.readNumber()
  }

  async getProxyHashIsValid(provider: ContractProvider, hash: Buffer) {
    let res = await provider.get('proxy_hash_is_valid', [{ type: 'int', value: BigInt('0x' + hash.toString('hex')) }])
    return res.stack.readNumber() !== 0
  }

  async getWorkerHashIsValid(provider: ContractProvider, hash: Buffer) {
    let res = await provider.get('worker_hash_is_valid', [{ type: 'int', value: BigInt('0x' + hash.toString('hex')) }])
    return res.stack.readNumber() !== 0
  }

  async getModelHashIsValid(provider: ContractProvider, hash: Buffer) {
    let res = await provider.get('model_hash_is_valid', [{ type: 'int', value: BigInt('0x' + hash.toString('hex')) }])
    return res.stack.readNumber() !== 0
  }

  async getPublicKeyIsValid(provider: ContractProvider, hash: Buffer) {
    let res = await provider.get('public_key_is_valid', [{ type: 'int', value: BigInt('0x' + hash.toString('hex')) }])
    return res.stack.readNumber() !== 0
  }

  async getCurParams(provider: ContractProvider) {
    let res = await provider.get('get_cur_params', [])
    return {
      paramsVersion: res.stack.readNumber(),
      uniqueId: res.stack.readNumber(),
      isTest: res.stack.readNumber(),
      pricePerToken: res.stack.readBigNumber(),
      workerFeePerToken: res.stack.readBigNumber(),
      cachedTokensPriceMultiplier: res.stack.readNumber(),
      reasoningTokensPriceMultiplier: res.stack.readNumber(),
      proxyDelayBeforeClose: res.stack.readNumber(),
      clientDelayBeforeClose: res.stack.readNumber(),
      minProxyStake: res.stack.readBigNumber(),
      minClientStake: res.stack.readBigNumber(),
      proxyScHash: res.stack.readBigNumber(),
      workerScHash: res.stack.readBigNumber(),
      clientScHash: res.stack.readBigNumber(),
    }
  }

  async getAllParams(provider: ContractProvider) {
    const state = await provider.getState()

    if (state.state.type == 'uninit') {
      return null
    }
    if (state.state.type == 'frozen') {
      return null
    }
    if (!state.state.data) {
      return null
    }

    const cell = Cell.fromBoc(state.state.data)[0]

    const cs = cell.beginParse()

    const ownerAddress = cs.loadAddress()

    const data = cs.loadRef().beginParse()
    const proxyHashes = data.loadDict<bigint, BitString>(Dictionary.Keys.BigUint(256), Dictionary.Values.BitString(0))
    const registredProxies = data.loadDict<number, ProxyInfo>(Dictionary.Keys.Uint(32), createProxyInfoValue())
    const lastProxySeqno = data.loadUint(32)
    const workerHashes = data.loadDict<bigint, BitString>(Dictionary.Keys.BigUint(256), Dictionary.Values.BitString(0))
    const modelHashes = data.loadDict<bigint, BitString>(Dictionary.Keys.BigUint(256), Dictionary.Values.BitString(0))
    data.endParse()

    const version = cs.loadUint(32)

    const pcs = cs.loadRef().beginParse()

    const structVersion = pcs.loadUint(8)
    const paramsVersion = pcs.loadUint(32)
    const uniqueId = pcs.loadUint(32)
    const isTest = pcs.loadBit()
    const pricePerToken = pcs.loadCoins()
    const workerFeePerToken = pcs.loadCoins()
    let promptTokensPriceMultiplier = 10000
    if (structVersion >= 3) {
      promptTokensPriceMultiplier = pcs.loadUint(32)
    }
    let cachedTokensPriceMultiplier = 10000
    if (structVersion >= 2) {
      cachedTokensPriceMultiplier = pcs.loadUint(32)
    }
    let completionTokensPriceMultiplier = 10000
    if (structVersion >= 3) {
      completionTokensPriceMultiplier = pcs.loadUint(32)
    }
    let reasoningTokensPriceMultiplier = 10000
    if (structVersion >= 2) {
      reasoningTokensPriceMultiplier = pcs.loadUint(32)
    }
    const proxyDelayBeforeClose = pcs.loadUint(32)
    const clientDelayBeforeClose = pcs.loadUint(32)
    let minProxyStake = toNano(1)
    let minClientStake = toNano(1)
    if (structVersion >= 1) {
      minProxyStake = pcs.loadCoins()
      minClientStake = pcs.loadCoins()
    }

    pcs.loadBits(3)
    const proxyScCode = pcs.loadRef()
    const workerScCode = pcs.loadRef()
    const clientScCode = pcs.loadRef()
    pcs.endParse()

    let publicKeys: Dictionary<bigint, PublicKeyInfo> = Dictionary.empty(null, null)
    let keyManagerPublicKey = BigInt(0)
    let keyManagerImageHash = BigInt(0)
    let keyManagerNetAddr: ProxyInfo = {
      addr: '',
    }

    if (structVersion >= 4) {
      let pkcs = cs.loadRef().beginParse()

      publicKeys = pkcs.loadDict<bigint, PublicKeyInfo>(Dictionary.Keys.BigUint(256), createPublicKeyInfoValue())
      keyManagerPublicKey = pkcs.loadUintBig(256)
      keyManagerImageHash = pkcs.loadUintBig(256)
      keyManagerNetAddr = createProxyInfoValue().parse(pkcs)
    }

    cs.endParse()

    const params: CocoonParams = {
      struct_version: structVersion,
      params_version: paramsVersion,
      unique_id: uniqueId,
      is_test: isTest,
      price_per_token: pricePerToken,
      worker_fee_per_token: workerFeePerToken,
      prompt_tokens_price_multiplier: promptTokensPriceMultiplier,
      cached_tokens_price_multiplier: cachedTokensPriceMultiplier,
      completion_tokens_price_multiplier: completionTokensPriceMultiplier,
      reasoning_tokens_price_multiplier: reasoningTokensPriceMultiplier,
      proxy_delay_before_close: proxyDelayBeforeClose,
      client_delay_before_close: clientDelayBeforeClose,
      min_proxy_stake: minProxyStake,
      min_client_stake: minClientStake,
      proxy_sc_code: proxyScCode,
      worker_sc_code: workerScCode,
      client_sc_code: clientScCode,
    }

    const conf: CocoonRootConfig = {
      owner_address: ownerAddress,
      proxy_hashes: proxyHashes,
      registered_proxies: registredProxies,
      last_proxy_seqno: lastProxySeqno,
      worker_hashes: workerHashes,
      model_hashes: modelHashes,
      version: version,
      params: params,
      public_keys: publicKeys,
      key_manager_public_key: keyManagerPublicKey,
      key_manager_image_hash: keyManagerImageHash,
      key_manager_net_addr: keyManagerNetAddr,
    }

    return conf
  }
}
