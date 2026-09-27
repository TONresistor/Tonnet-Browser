import './runtime/buffer-polyfill'
import { Address } from '@ton/core'
import {
  buildWithdraw,
  finalizeDeposit,
  parseNote,
  prepareDeposit,
  type BuiltMessage,
  type DepositPhase,
  type DepositPrep,
  type Poseidon2,
  type WithdrawPhase,
} from '@tonresistor/zkresistor-sdk'
import type { ZkResistorPool } from '@shared/types'
import { zkResistorClient } from './client'
import { insertProver, poseidon2, withdrawProver } from './runtime/artifacts'
import { TonPoolSessionFactory, type TonPoolSession } from './runtime/merkle'

const sessions = new TonPoolSessionFactory()
const preparedDeposits = new Map<
  string,
  {
    pool: ZkResistorPool
    walletAddress: string
    prep: DepositPrep
    poseidon: Poseidon2
    session: TonPoolSession
  }
>()

const PHASE_LABELS: Record<DepositPhase | WithdrawPhase, string> = {
  'reading-pool': 'Reading Pool state',
  'syncing-state': 'Verifying private state',
  'computing-witness': 'Computing witness',
  'generating-proof': 'Generating zero-knowledge proof',
  'building-transaction': 'Building transaction',
}

export interface PreparedGramDeposit {
  id: string
  note: string
}

export function discardPreparedDeposit(preparedId: string): void {
  preparedDeposits.delete(preparedId)
}

export async function prepareGramDeposit(
  pool: ZkResistorPool,
  walletAddress: string,
  onProgress: (message: string) => void
): Promise<PreparedGramDeposit> {
  const normalizedWallet = canonicalAddress(walletAddress)
  onProgress('Loading proving tools')
  const poseidon = await poseidon2()
  onProgress('Verifying Pool state')
  const session = sessions.open(pool.address)
  const prep = await prepareDeposit(session.client, {
    kind: 'ton',
    poolAddress: pool.address,
    asset: 'GRAM',
    denomination: BigInt(pool.denomination),
    userAddress: normalizedWallet,
    stateProvider: session.stateProvider,
  })
  const id = crypto.randomUUID()
  preparedDeposits.set(id, { pool, walletAddress: normalizedWallet, prep, poseidon, session })
  return { id, note: prep.noteString }
}

export async function submitGramDeposit(
  preparedId: string,
  walletAddress: string,
  onProgress: (message: string) => void
): Promise<void> {
  const prepared = preparedDeposits.get(preparedId)
  if (!prepared) throw new Error('Generate a new secret note before depositing')
  try {
    if (canonicalAddress(walletAddress) !== prepared.walletAddress) {
      throw new Error('The wallet changed after the secret note was generated')
    }
    const plan = await finalizeDeposit(prepared.session.client, {
      prep: prepared.prep,
      poseidon2: prepared.poseidon,
      insertProver,
      onProgress: (phase) => onProgress(PHASE_LABELS[phase]),
    })
    onProgress('Waiting for wallet approval')
    await sendMessage('deposit', prepared.pool, plan.message)
  } finally {
    discardPreparedDeposit(preparedId)
  }
}

export async function withdrawGram(
  pool: ZkResistorPool,
  noteString: string,
  recipientAddress: string,
  onProgress: (message: string) => void
): Promise<void> {
  const note = parseNote(noteString.trim())
  if (!note || note.poolKind !== 'ton') throw new Error('Invalid GRAM ZKResistor note')
  if (
    note.denominationUnits !== BigInt(pool.denomination) ||
    !Address.parse(note.poolAddress).equals(Address.parse(pool.address))
  ) {
    throw new Error('This note does not belong to this Pool')
  }
  const recipient = canonicalAddress(recipientAddress)
  onProgress('Loading proving tools')
  const poseidon = await poseidon2()
  onProgress('Verifying Pool state')
  const session = sessions.open(pool.address)
  const plan = await buildWithdraw(session.client, {
    kind: 'ton',
    note,
    poolAddress: pool.address,
    recipientAddress: recipient,
    stateProvider: session.stateProvider,
    poseidon2: poseidon,
    withdrawProver,
    onProgress: (phase) => onProgress(PHASE_LABELS[phase]),
  })
  onProgress('Waiting for wallet approval')
  await sendMessage('withdraw', pool, plan.message)
}

async function sendMessage(operation: 'deposit' | 'withdraw', pool: ZkResistorPool, message: BuiltMessage) {
  if (!Address.parse(message.address).equals(Address.parse(pool.address))) {
    throw new Error('Generated transaction targets another Pool')
  }
  return zkResistorClient.send({
    operation,
    poolAddress: pool.address,
    value: message.value.toString(),
    payload: message.payload.toBoc().toString('base64'),
  })
}

function canonicalAddress(value: string): string {
  return Address.parse(value).toString({ bounceable: true, urlSafe: true })
}
