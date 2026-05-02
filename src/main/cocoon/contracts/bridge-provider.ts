/**
 * BridgeProvider — ContractProvider adapter for WsBridgeClient.
 *
 * Bridges @ton/core's ContractProvider interface to the tonutils-bridge WebSocket
 * client so that vendored contract wrappers (CocoonWallet, CocoonClient, etc.)
 * can be used without a full TonClient.
 *
 * Bridge stack format (tonutils-bridge serializeStack, wsbridge/helpers.go):
 *   Each stack item is serialized as:
 *     - decimal string  (e.g. "123")  for *big.Int values
 *     - base64 BOC string             for *cell.Cell / *cell.Slice values
 *     - null                          for nil
 *   There is NO type tag — items are plain `string | null`.
 */

import {
  Address,
  Cell,
  Contract,
  ContractGetMethodResult,
  ContractProvider,
  ContractState,
  ExtraCurrency,
  OpenedContract,
  Sender,
  SendMode,
  StateInit,
  Transaction,
  TupleItem,
  TupleReader,
  beginCell,
  openContract,
} from '@ton/core'
import type { WsBridgeClient } from '../../wallet/ws-bridge-client'

// Real bridge stack item: plain string (decimal int or base64 BOC) or null.
type BridgeStackItem = string | null

type BridgeRunMethodResult = {
  stack?: BridgeStackItem[]
  exit_code?: number
}

type Maybe<T> = T | null | undefined

/**
 * Convert a single bridge stack item to a @ton/core TupleItem.
 *
 * Detection rules:
 *  - null              → TupleItemNull
 *  - decimal integer   → TupleItemInt  (BigInt)
 *  - anything else     → TupleItemCell (base64 BOC); readCell() and readSlice()
 *                        both accept 'cell'-typed items in TupleReader.
 */
export function bridgeItemToTupleItem(item: BridgeStackItem): TupleItem {
  if (item === null) {
    return { type: 'null' }
  }
  if (/^-?\d+$/.test(item)) {
    return { type: 'int', value: BigInt(item) }
  }
  // Treat as base64-encoded BOC (cell or slice)
  const cell = Cell.fromBase64(item)
  return { type: 'cell', cell }
}

/** Convert the bridge's raw stack array into a TupleReader. */
export function bridgeStackToTupleReader(stack: BridgeStackItem[]): TupleReader {
  const items: TupleItem[] = stack.map(bridgeItemToTupleItem)
  return new TupleReader(items)
}

export class BridgeProvider implements ContractProvider {
  constructor(
    private readonly bridge: WsBridgeClient,
    private readonly addr: Address,
    private readonly init?: StateInit
  ) {}

  async getState(): Promise<ContractState> {
    const balance = BigInt(await this.bridge.getBalance(this.addr.toString()))
    return {
      balance,
      extracurrency: null,
      last: null,
      state: { type: 'active', code: undefined, data: undefined },
    }
  }

  async get(name: string | number, args: TupleItem[]): Promise<ContractGetMethodResult> {
    if (typeof name !== 'string') {
      throw new Error('BridgeProvider: numeric method ids are not supported — pass method name as string')
    }
    if (args.length > 0) {
      throw new Error(
        'BridgeProvider: typed TupleItem args are not supported in MVP — extend bridgeItemToParam() if needed'
      )
    }
    const raw = (await this.bridge.runMethod(this.addr.toString(), name)) as BridgeRunMethodResult | null
    const exitCode = raw?.exit_code
    if (exitCode !== undefined && exitCode !== 0 && exitCode !== 1) {
      throw new Error(`BridgeProvider: contract get-method failed with exit_code=${exitCode}`)
    }
    const stack = bridgeStackToTupleReader(raw?.stack ?? [])
    return { stack }
  }

  async external(message: Cell): Promise<void> {
    await this.bridge.broadcast(message.toBoc())
  }

  async internal(
    via: Sender,
    args: {
      value: bigint | string
      extracurrency?: ExtraCurrency
      bounce?: Maybe<boolean>
      sendMode?: Maybe<SendMode>
      body?: Maybe<Cell | string>
    }
  ): Promise<void> {
    const value = typeof args.value === 'string' ? BigInt(args.value) : args.value
    const body =
      typeof args.body === 'string'
        ? beginCell().storeUint(0, 32).storeStringTail(args.body).endCell()
        : (args.body ?? undefined)
    await via.send({
      to: this.addr,
      value,
      bounce: args.bounce ?? true,
      sendMode: args.sendMode ?? SendMode.PAY_GAS_SEPARATELY,
      body,
      init: this.init,
    })
  }

  open<T extends Contract>(contract: T): OpenedContract<T> {
    return openContract(contract, ({ address, init }) => {
      return new BridgeProvider(this.bridge, address, init ?? undefined)
    })
  }

  async getTransactions(_address: Address, _lt: bigint, _hash: Buffer, _limit?: number): Promise<Transaction[]> {
    throw new Error('BridgeProvider.getTransactions() is unsupported by the current bridge adapter')
  }
}

/**
 * Top-level helper: wrap a contract instance with a BridgeProvider so its
 * methods can be called without manually constructing a provider.
 *
 * Usage:
 *   const wallet = openBridgeContract(bridge, CocoonWallet.createFromAddress(addr))
 *   await wallet.getSeqno()
 */
export function openBridgeContract<T extends Contract>(bridge: WsBridgeClient, contract: T): OpenedContract<T> {
  return openContract(contract, ({ address, init }) => {
    return new BridgeProvider(bridge, address, init ?? undefined)
  })
}
