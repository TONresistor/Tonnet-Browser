import { Address, Cell } from '@ton/core'
import {
  MIN_DEPOSIT_VALUE,
  MIN_WITHDRAW_GAS,
  OP_DEPOSIT,
  OP_WITHDRAW,
  parseSparseSetUpdateProofCell,
} from '@tonresistor/zkresistor-sdk'
import type { ZkResistorPool, ZkResistorSendRequest } from '../../shared/ipc-contract/zkresistor'

export interface ValidatedZkResistorTransaction {
  body: Cell
  recipient?: string
}

export function validateZkResistorTransaction(
  request: ZkResistorSendRequest,
  pool: ZkResistorPool,
  walletAddress: string
): ValidatedZkResistorTransaction {
  const body = Cell.fromBase64(request.payload)
  if (body.isExotic) throw new Error('ZKResistor payload must be an ordinary Cell')
  const value = BigInt(request.value)
  const slice = body.beginParse()
  const opcode = slice.loadUint(32)
  slice.loadUintBig(64)

  if (request.operation === 'deposit') {
    if (opcode !== OP_DEPOSIT) throw new Error('Deposit payload has the wrong operation')
    const sender = slice.loadAddress()
    if (!sender.equals(Address.parse(walletAddress))) throw new Error('Deposit payload is bound to another wallet')
    slice.loadUintBig(256)
    slice.loadUintBig(256)
    slice.loadRef()
    parseSparseSetUpdateProofCell(slice.loadRef())
    assertEnd(slice.remainingBits, slice.remainingRefs)
    const expected = BigInt(pool.denomination) + MIN_DEPOSIT_VALUE + 50_000_000n
    if (value !== expected) throw new Error('Deposit value does not match the Pool denomination')
    return { body }
  }

  if (opcode !== OP_WITHDRAW) throw new Error('Withdrawal payload has the wrong operation')
  slice.loadUintBig(256)
  slice.loadUintBig(256)
  const recipient = slice.loadAddress()
  if (recipient.workChain !== 0 || recipient.hash.every((byte) => byte === 0)) {
    throw new Error('Withdrawal recipient is invalid')
  }
  slice.loadRef()
  parseSparseSetUpdateProofCell(slice.loadRef())
  assertEnd(slice.remainingBits, slice.remainingRefs)
  if (value !== MIN_WITHDRAW_GAS + 50_000_000n) throw new Error('Withdrawal value is not canonical')
  return { body, recipient: recipient.toString({ bounceable: false, urlSafe: true }) }
}

function assertEnd(bits: number, refs: number): void {
  if (bits !== 0 || refs !== 0) throw new Error('ZKResistor payload contains trailing data')
}
