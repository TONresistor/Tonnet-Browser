import { Address, beginCell, Cell, internal, loadMessage, loadMessageRelaxed, loadOutList, SendMode } from '@ton/core'
import { keyPairFromSeed, signVerify } from '@ton/crypto'
import { describe, expect, it } from 'vitest'
import { buildExternalWalletBoc, buildInternalWalletBoc } from '../wallet-boc'
import { createWalletContract, WalletVersionSchema } from '../wallet-versions'

describe('buildExternalWalletBoc', () => {
  it('builds a verifiable V5R1 signed internal body with send mode 3', () => {
    const keys = keyPairFromSeed(Buffer.alloc(32, 7))
    const contract = createWalletContract('v5R1', keys.publicKey)
    const result = buildInternalWalletBoc({
      walletContract: contract,
      secretKey: keys.secretKey,
      messages: [internal({ to: Address.parseRaw(`0:${'22'.repeat(32)}`), value: 7n })],
      seqno: 8,
      validUntil: 1300,
    })
    const body = Cell.fromBase64(result.boc)
    const signed = body.beginParse()
    const unsigned = beginCell().storeBits(signed.loadBits(signed.remainingBits - 512))
    for (const ref of body.refs) unsigned.storeRef(ref)
    const signature = signed.loadBuffer(64)
    expect(signVerify(unsigned.endCell().hash(), signature, keys.publicKey)).toBe(true)
    const payload = body.beginParse()
    expect(payload.loadUint(32)).toBe(0x73696e74)
    payload.skip(32)
    expect(payload.loadUint(32)).toBe(1300)
    expect(payload.loadUint(32)).toBe(8)
    const actions = loadOutList(payload.loadMaybeRef()!.beginParse())
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ type: 'sendMsg', mode: 3 })
    keys.secretKey.fill(0)
  })

  it('refuses signed internal messages for legacy wallet contracts', () => {
    const keys = keyPairFromSeed(Buffer.alloc(32, 7))
    expect(() =>
      buildInternalWalletBoc({
        walletContract: createWalletContract('v4R2', keys.publicKey),
        secretKey: keys.secretKey,
        messages: [],
        seqno: 1,
        validUntil: 1300,
      })
    ).toThrow('V5R1')
    keys.secretKey.fill(0)
  })
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
