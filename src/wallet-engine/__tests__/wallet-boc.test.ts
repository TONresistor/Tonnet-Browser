import { Address, beginCell, Cell, internal, loadMessage, loadMessageRelaxed, loadOutList, SendMode } from '@ton/core'
import { keyPairFromSeed } from '@ton/crypto'
import { describe, expect, it } from 'vitest'
import { buildExternalWalletBoc } from '../wallet-boc'
import { createWalletContract, WalletVersionSchema } from '../wallet-versions'

describe('buildExternalWalletBoc', () => {
  it.each(WalletVersionSchema.options)('builds a first transfer for %s', (version) => {
    const keypair = keyPairFromSeed(Buffer.alloc(32, 7))
    const walletContract = createWalletContract(version, keypair.publicKey)
    const recipient = Address.parseRaw(`0:${'22'.repeat(32)}`)
    const comment = beginCell().storeUint(0, 32).storeStringTail('payment memo').endCell()
    const message = internal({ to: recipient, value: 123_456_789n, bounce: false, body: comment })
    for (const seqno of [0, 7]) {
      const result = buildExternalWalletBoc({
        walletContract,
        secretKey: keypair.secretKey,
        messages: [message],
        seqno,
        maxTimeout: 300,
        nowSeconds: 1_000,
      })
      const external = loadMessage(Cell.fromBase64(result.boc).beginParse())
      expect(external.info.type).toBe('external-in')
      if (external.info.type !== 'external-in') throw new Error('Expected external wallet message')
      expect(external.info.dest.equals(walletContract.address)).toBe(true)
      if (seqno === 0) {
        expect(external.init?.code?.equals(walletContract.init.code!)).toBe(true)
        expect(external.init?.data?.equals(walletContract.init.data!)).toBe(true)
      } else {
        expect(external.init).toBeNull()
      }
      const signed = external.body.beginParse()
      if (version === 'v5R1') {
        expect(signed.loadUint(32)).toBe(0x7369676e)
      } else {
        signed.skip(512)
      }
      signed.skip(32) // wallet id
      expect(signed.loadUint(32)).toBe(1_300)
      expect(signed.loadUint(32)).toBe(seqno)
      let transfer
      if (version === 'v5R1') {
        const actionList = signed.loadMaybeRef()
        expect(actionList).not.toBeNull()
        const actions = loadOutList(actionList!.beginParse())
        expect(actions).toHaveLength(1)
        const action = actions[0]
        if (action.type !== 'sendMsg') throw new Error('Expected send action')
        expect(action.mode).toBe(SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS)
        transfer = action.outMsg
        expect(signed.loadBit()).toBe(false) // no extension actions
      } else {
        if (version === 'v4R2') expect(signed.loadUint(8)).toBe(0) // send-message action
        expect(signed.loadUint(8)).toBe(SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS)
        transfer = loadMessageRelaxed(signed.loadRef().beginParse())
      }
      expect(transfer.info.type).toBe('internal')
      if (transfer.info.type !== 'internal') throw new Error('Expected internal transfer')
      expect(transfer.info.dest.equals(recipient)).toBe(true)
      expect(transfer.info.value.coins).toBe(123_456_789n)
      expect(transfer.info.bounce).toBe(false)
      expect(transfer.body.equals(comment)).toBe(true)
      expect(result).toMatchObject({ seqno, validUntil: 1_300 })
    }
    keypair.publicKey.fill(0)
    keypair.secretKey.fill(0)
  })
})
