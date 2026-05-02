/**
 * Cocoon-specific TON transactions.
 *
 * Two distinct signing flows are needed (everything else goes through the
 * client-runner via HTTP):
 *
 *  - sendFromOwnerWallet : signs from the user's V4R2 owner wallet using the
 *    24-word mnemonic. Used for funding the cocoon wallet, top-ups, cashout.
 *
 *  - sendFromCocoonWallet : signs an external message for the custom
 *    `cocoon_wallet.fc` smart contract using its 32-byte Ed25519 secret. Used
 *    when the runner is offline (final unstake step, partial withdrawals).
 *
 * Both publish via the existing WsBridgeClient (the same bridge the main TON
 * wallet uses), so no extra TonClient or Toncenter API key is needed.
 */

import { Address, beginCell, internal, storeMessage, SendMode, type Cell } from '@ton/core'
import { mnemonicToPrivateKey, keyPairFromSeed } from '@ton/crypto'
import { WalletContractV4 } from '@ton/ton'
import { createLogger } from '../../shared/logger'
import type { WsBridgeClient } from '../wallet/ws-bridge-client'
import { CocoonWallet, cocoonWalletConfigToCell } from './contracts/wrappers/CocoonWallet'
import { getCocoonWalletCode } from './wallet'

const log = createLogger('cocoon:contracts')

const VALID_UNTIL_SECONDS = 3600

export interface SendResult {
  bocHash: string
  seqno: number
}

/**
 * Build the {code, data} StateInit for a cocoon_wallet SC. Used by callers
 * that need to deploy the SC on its first send (passing it to
 * `sendFromCocoonWallet({init: ...})`).
 */
export function buildCocoonWalletInit(ownerAddress: string, nodePublicKeyHex: string): { code: Cell; data: Cell } {
  const code = getCocoonWalletCode()
  const data = cocoonWalletConfigToCell({
    publicKey: Buffer.from(nodePublicKeyHex, 'hex'),
    ownerAddress: Address.parse(ownerAddress),
  })
  return { code, data }
}

export interface SendFromOwnerOptions {
  /**
   * When true, the message uses CARRY_ALL_REMAINING_BALANCE + DESTROY_IF_ZERO
   * so the wallet sends every nanoTON and self-destructs on the chain.
   * `amount` is ignored in this mode.
   *
   * Use this for the legacy "drain owner V4R2" sweep where we want zero
   * residual and don't intend to reuse the wallet.
   */
  drainAll?: boolean
}

/**
 * Sign and broadcast a transfer from the user's owner V4R2 wallet.
 *
 * @param wsBridge   connected WsBridgeClient instance
 * @param mnemonic   24-word mnemonic of the owner wallet
 * @param destination target address (Address or base64/raw string)
 * @param amount     amount to send in nanoTON (ignored when options.drainAll=true)
 * @param body       optional message body cell (e.g. opcode for the cocoon SC)
 * @param options    optional send tweaks (drain-all + self-destruct)
 */
export async function sendFromOwnerWallet(
  wsBridge: WsBridgeClient,
  mnemonic: string[],
  destination: Address | string,
  amount: bigint,
  body?: Cell,
  options: SendFromOwnerOptions = {}
): Promise<SendResult> {
  const keys = await mnemonicToPrivateKey(mnemonic)
  const wallet = WalletContractV4.create({ workchain: 0, publicKey: keys.publicKey })
  const dest = typeof destination === 'string' ? Address.parse(destination) : destination

  // A V4R2 wallet that has never sent a message yet is not deployed on-chain;
  // get_method `seqno` returns exit_code -256 ("contract is not initialized").
  // Treat that case as seqno=0 — the external-in message below will carry
  // `init` (state init) and deploy the wallet on its first send.
  let seqno: number
  try {
    seqno = await wsBridge.getSeqno(wallet.address.toString())
  } catch (err) {
    const msg = (err as Error).message ?? ''
    if (msg.includes('not initialized') || msg.includes('-256')) {
      log.info('Owner wallet not deployed yet, using seqno=0 (init will deploy it)')
      seqno = 0
    } else {
      throw err
    }
  }

  // Type cast required: createTransfer's return type is a distributive conditional
  // (T extends SendArgsSignable ? Promise<Cell> : Cell). TypeScript cannot resolve
  // it to Cell from the union bound, but secretKey is always present here so the
  // synchronous Cell branch is always taken at runtime.
  // If args ever change to a signable variant, the `as Cell` would mask an async bug.
  // Drain-all sets value=0 + mode 128+32: the message carries all remaining
  // wallet balance and self-destructs the contract once it reaches 0. Otherwise
  // we use the normal "send exactly `amount`, deduct gas from the wallet"
  // flow so the wallet stays alive for future sends.
  const sendMode = options.drainAll
    ? SendMode.CARRY_ALL_REMAINING_BALANCE + SendMode.DESTROY_ACCOUNT_IF_ZERO
    : SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS
  const value = options.drainAll ? 0n : amount

  const transfer = wallet.createTransfer({
    seqno,
    secretKey: keys.secretKey,
    messages: [
      internal({
        to: dest,
        value,
        bounce: !!body,
        ...(body ? { body } : {}),
      }),
    ],
    sendMode,
    timeout: Math.floor(Date.now() / 1000) + VALID_UNTIL_SECONDS,
  } as Parameters<typeof wallet.createTransfer>[0]) as Cell

  const extMsg = beginCell()
    .store(
      storeMessage({
        info: { type: 'external-in', dest: wallet.address, importFee: 0n },
        init: seqno === 0 ? wallet.init : undefined,
        body: transfer,
      })
    )
    .endCell()

  const boc = extMsg.toBoc()
  await wsBridge.broadcast(boc)
  log.info(`Owner wallet send: ${dest.toString({ bounceable: false }).slice(0, 8)}… seqno=${seqno}`)

  return { bocHash: extMsg.hash().toString('hex'), seqno }
}

/**
 * Sign and broadcast an external message from the cocoon_wallet SC.
 * Uses the canonical CocoonWallet.createExternalMessage() which produces the
 * correct bit layout for the outbound message cell (StateInit Maybe bit in the
 * right slot, body Either bit correct).
 */
export interface SendFromCocoonOptions {
  /**
   * When true, the message uses CARRY_ALL_REMAINING_BALANCE + DESTROY_IF_ZERO
   * so the wallet sends every nanoTON and the SC self-destructs on the chain.
   * `amount` is ignored in this mode.
   */
  drainAll?: boolean
  /**
   * StateInit to attach when the SC is uninit (seqno read fails with -256
   * "contract is not initialized"). The first send carries this init, which
   * deploys the cocoon_wallet code on chain. Subsequent sends omit it.
   *
   * Build with `buildCocoonWalletInit(ownerAddress, nodePublicKeyHex)`.
   */
  init?: { code: Cell; data: Cell }
}

export async function sendFromCocoonWallet(
  wsBridge: WsBridgeClient,
  cocoonAddress: Address | string,
  nodeSecretKey32: Buffer,
  destination: Address | string,
  amount: bigint,
  body?: Cell,
  options: SendFromCocoonOptions = {}
): Promise<SendResult> {
  if (nodeSecretKey32.length !== 32) {
    throw new Error(`nodeSecretKey32 must be 32 bytes, got ${nodeSecretKey32.length}`)
  }
  const keyPair = keyPairFromSeed(nodeSecretKey32)
  const cocoonAddr = typeof cocoonAddress === 'string' ? Address.parse(cocoonAddress) : cocoonAddress
  const dest = typeof destination === 'string' ? Address.parse(destination) : destination

  // The SC may be uninit (account exists with balance but no code yet) — that
  // happens when funding TON arrived before any external send carried the
  // state init. runMethod('seqno') then errors with exit code -256. Treat
  // that as seqno=0 and attach the init below.
  let seqno: number
  try {
    const seqnoResult = (await wsBridge.runMethod(cocoonAddr.toString(), 'seqno')) as {
      stack?: Array<string | null>
    }
    seqno = parseSeqnoFromStack(seqnoResult)
  } catch (err) {
    const msg = (err as Error).message ?? ''
    if (msg.includes('not initialized') || msg.includes('-256')) {
      log.info('Cocoon wallet not deployed yet, using seqno=0 (init will deploy it)')
      seqno = 0
    } else {
      throw err
    }
  }
  const validUntil = Math.floor(Date.now() / 1000) + VALID_UNTIL_SECONDS

  const sendMode = options.drainAll
    ? SendMode.CARRY_ALL_REMAINING_BALANCE + SendMode.DESTROY_ACCOUNT_IF_ZERO
    : SendMode.PAY_GAS_SEPARATELY
  const value = options.drainAll ? 0n : amount

  // Canonical wrapper builds correctly-formed signed body (StateInit Maybe + body Either bits)
  const signedBody = CocoonWallet.createExternalMessage(
    [{ to: dest, value, body, bounce: !!body, mode: sendMode }],
    keyPair,
    // CocoonWallet always stores subwallet=0 in initial state (see cocoonWalletConfigToCell in
    // CocoonWallet.ts). This is NOT a configurable subwallet like V4R2; it is a fixed protocol field.
    { seqno, validUntil, subwalletId: 0 }
  )

  const extMsg = beginCell()
    .store(
      storeMessage({
        info: { type: 'external-in', dest: cocoonAddr, importFee: 0n },
        // Attach state init on first deploy (seqno=0). Without this, an
        // uninit cocoon_wallet (balance present, no code) would reject every
        // external message — runMethod('seqno') errors with -256, and the
        // current send would fail to land too.
        init: seqno === 0 && options.init ? options.init : undefined,
        body: signedBody,
      })
    )
    .endCell()

  const boc = extMsg.toBoc()
  await wsBridge.broadcast(boc)
  log.info(`Cocoon wallet send: ${dest.toString({ bounceable: false }).slice(0, 8)}… seqno=${seqno}`)

  return { bocHash: extMsg.hash().toString('hex'), seqno }
}

/**
 * The bridge serializes its TVM stack as a flat array of decimal strings (or null
 * for TVM null/empty). For the `seqno` method we expect exactly one decimal integer.
 */
function parseSeqnoFromStack(result: { stack?: Array<string | null> }): number {
  const top = result?.stack?.[0]
  if (top === undefined) throw new Error('runMethod(seqno) returned empty stack')
  if (top === null) throw new Error('runMethod(seqno) returned null')
  if (!/^-?\d+$/.test(top)) {
    throw new Error(`runMethod(seqno) returned non-numeric value: ${top}`)
  }
  const n = Number(top)
  if (!Number.isSafeInteger(n)) {
    throw new Error(`runMethod(seqno) overflowed Number safe range: ${top}`)
  }
  return n
}
