/**
 * Shared cocoon node-signing primitives.
 *
 * These were byte-identical (or inlined) across the withdraw/recovery flows
 * (recover-all, current-withdraw, recovery-driver). They are pure and carry no
 * per-flow policy (no gas top-up, no confirmation debounce, no queue
 * persistence) — that divergent logic stays in each caller.
 */
import { Address, beginCell, type Cell } from '@ton/core'
import { CocoonClient } from './contracts/wrappers/CocoonClient'
import { openBridgeContract } from './contracts/bridge-provider'
import { narrowClientState } from './constants'
import { errorMessage } from '../../shared/errors'
import { createLogger } from '../../shared/logger'
import type { TonBridgePort } from '../ports/ton-bridge'

const log = createLogger('cocoon:node-signing')

/**
 * op::owner_client_request_refund. Sent FROM the cocoon_node wallet TO the
 * client SC: on state=0 it requests the refund (SC → closing); on
 * state=1 + now>=unlock_ts it claims it (stake forwarded, SC self-destructs).
 */
export const OWNER_CLIENT_REQUEST_REFUND = 0xfafa6cc1

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Decode and validate a base64 cocoon_node Ed25519 secret (must be exactly 32 bytes). */
export function decodeNodeSecret(nodeSecretBase64: string): Buffer {
  const secret = Buffer.from(nodeSecretBase64, 'base64')
  if (secret.length !== 32) {
    throw new Error(`Cocoon node secret must be 32 bytes, got ${secret.length}`)
  }
  return secret
}

/** Build a client-SC message body: opcode(32 bits) + query_id 0 (64 bits) + excesses address. */
export function buildClientOpcodeBody(opcode: number, sendExcessesTo: string): Cell {
  return beginCell().storeUint(opcode, 32).storeUint(0, 64).storeAddress(Address.parse(sendExcessesTo)).endCell()
}

/** Read the client SC's on-chain state (0|1|2) and unlock timestamp, or null if unreadable. */
export async function readClientState(
  bridge: TonBridgePort,
  clientSCAddress: string
): Promise<{ state: 0 | 1 | 2; unlockTs: number } | null> {
  try {
    const client = CocoonClient.createFromAddress(Address.parse(clientSCAddress))
    const opened = openBridgeContract(bridge, client)
    const data = await opened.getData()
    return { state: narrowClientState(data.state), unlockTs: data.unlockTs }
  } catch (err) {
    log.warn(`client getData failed for ${clientSCAddress.slice(0, 8)}...: ${errorMessage(err)}`)
    return null
  }
}
