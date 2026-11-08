import { Address, beginCell, Cell } from '@ton/core'
import { z } from 'zod'
import type { WalletBridgePort } from './bridge-port'
import type { TonConnectOutMessage } from './signing-types'

const coins = z
  .string()
  .regex(/^\d+$/)
  .refine((value) => /^\d+$/.test(value) && BigInt(value) < 1n << 120n, 'Amount exceeds coin limit')
const address = z.string().refine((value) => {
  try {
    const parsed = Address.parseFriendly(value)
    return !parsed.isTestOnly && parsed.address.workChain === 0
  } catch {
    return false
  }
}, 'Expected a mainnet user-friendly address')
const boc = z
  .string()
  .max(131072)
  .refine((value) => {
    try {
      Cell.fromBase64(value)
      return true
    } catch {
      return false
    }
  }, 'Invalid BoC')
const queryId = z
  .string()
  .regex(/^\d+$/)
  .refine((value) => /^\d+$/.test(value) && BigInt(value) < 1n << 64n, 'Invalid query ID')
const common = {
  attachAmount: coins.optional(),
  responseDestination: address.optional(),
  customPayload: boc.optional(),
  forwardAmount: coins.optional(),
  forwardPayload: boc.optional(),
  queryId: queryId.optional(),
}

export const StructuredTransferItemSchema = z.discriminatedUnion('type', [
  z
    .object({ type: z.literal('ton'), address, amount: coins, payload: boc.optional(), stateInit: boc.optional() })
    .strict(),
  z.object({ type: z.literal('jetton'), master: address, destination: address, amount: coins, ...common }).strict(),
  z.object({ type: z.literal('nft'), nftAddress: address, newOwner: address, ...common }).strict(),
])
export type StructuredTransferItem = z.infer<typeof StructuredTransferItemSchema>

function stack(result: unknown): unknown[] {
  if (!result || typeof result !== 'object') throw new Error('Missing asset contract result')
  const { exit_code, stack } = result as { exit_code?: unknown; stack?: unknown }
  if ((exit_code !== 0 && exit_code !== 1) || !Array.isArray(stack)) throw new Error('Asset get method failed')
  return stack
}
function stackAddress(value: unknown): Address {
  if (typeof value !== 'string') throw new Error('Invalid asset address')
  return Cell.fromBase64(value).beginParse().loadAddress()
}
function stackInteger(value: unknown): bigint {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) throw new Error('Invalid asset integer')
  return BigInt(value)
}

/** Resolve asset ownership and build standard transfer bodies using only the TON bridge. */
export async function resolveStructuredTransfers(
  input: readonly StructuredTransferItem[],
  owner: string,
  bridge: Pick<WalletBridgePort, 'runMethod'>,
  assertCurrent: () => void
): Promise<TonConnectOutMessage[]> {
  const items = z.array(StructuredTransferItemSchema).min(1).max(4).parse(input)
  const sender = Address.parse(owner)
  const messages: TonConnectOutMessage[] = []
  const spent = new Map<string, bigint>()
  const nfts = new Set<string>()
  const run = async (contract: string, method: string, params?: unknown[]) => {
    assertCurrent()
    const result = await bridge.runMethod(contract, method, params)
    assertCurrent()
    return stack(result)
  }
  for (const item of items) {
    assertCurrent()
    if (item.type === 'ton') {
      messages.push({ address: item.address, amount: item.amount, payload: item.payload, stateInit: item.stateInit })
      continue
    }
    let target: Address
    if (item.type === 'jetton') {
      const resolved = await run(item.master, 'get_wallet_address', [
        { type: 'slice', boc: beginCell().storeAddress(sender).endCell().toBoc().toString('base64') },
      ])
      target = stackAddress(resolved[0])
      const data = await run(target.toString(), 'get_wallet_data')
      if (!stackAddress(data[1]).equals(sender) || !stackAddress(data[2]).equals(Address.parse(item.master)))
        throw new Error('Jetton wallet owner or master mismatch')
      const total = (spent.get(target.toRawString()) ?? 0n) + BigInt(item.amount)
      if (total > stackInteger(data[0])) throw new Error('Insufficient jetton balance')
      spent.set(target.toRawString(), total)
    } else {
      target = Address.parse(item.nftAddress)
      if (nfts.has(target.toRawString())) throw new Error('Duplicate NFT transfer')
      nfts.add(target.toRawString())
      const data = await run(item.nftAddress, 'get_nft_data')
      if (stackInteger(data[0]) !== -1n || !stackAddress(data[3]).equals(sender))
        throw new Error('NFT is not owned by the connected account')
    }
    if (target.workChain !== 0) throw new Error('Unsupported asset workchain')
    const forward = BigInt(item.forwardAmount ?? '1')
    const attached = BigInt(item.attachAmount ?? (50_000_000n + forward).toString())
    if (attached <= forward || attached >= 1n << 120n)
      throw new Error('Attached amount must cover forwarding and execution within the coin limit')
    const body = beginCell()
      .storeUint(item.type === 'jetton' ? 0x0f8a7ea5 : 0x5fcc3d14, 32)
      .storeUint(BigInt(item.queryId ?? '0'), 64)
    if (item.type === 'jetton') body.storeCoins(BigInt(item.amount))
    body
      .storeAddress(Address.parse(item.type === 'jetton' ? item.destination : item.newOwner))
      .storeAddress(item.responseDestination ? Address.parse(item.responseDestination) : sender)
      .storeMaybeRef(item.customPayload ? Cell.fromBase64(item.customPayload) : null)
      .storeCoins(forward)
      .storeBit(Boolean(item.forwardPayload))
    if (item.forwardPayload) body.storeRef(Cell.fromBase64(item.forwardPayload))
    messages.push({
      address: target.toString({ bounceable: true }),
      amount: attached.toString(),
      payload: body.endCell().toBoc().toString('base64'),
    })
  }
  assertCurrent()
  return messages
}
