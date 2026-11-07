import {
  Address,
  beginCell,
  Cell,
  internal,
  loadMessage,
  loadStateInit,
  loadTransaction,
  type MessageRelaxed,
} from '@ton/core'
import { randomUUID } from 'node:crypto'
import type { WalletBridgePort } from './bridge-port'
import type { WalletChainSnapshot, WalletConfirmationReceipt } from './network-types'
import type { WalletIdentitySnapshot } from './wallet-identity'
import type { SupportedWalletContract } from './wallet-versions'
import { OperationJournal, intentFingerprint, isOperationPending, type WalletOperation } from './journal'
import { WalletEngineError } from './errors'
import { buildExternalWalletBoc } from './wallet-boc'
import { preflightTonTransfer } from './transfer-preflight'

export interface TransferMessage {
  address: string
  amount: string
  payload?: string
  stateInit?: string
  bounce?: boolean
}
export interface TransferIntent {
  operationId: string
  messages: TransferMessage[]
  timeoutSeconds?: number
  validUntil?: number
  context?: string
  requestHash?: string
  comment?: string
  commentEncrypted?: boolean
}
export interface TransferReview {
  operationId: string
  identity: WalletIdentitySnapshot
  messages: readonly TransferMessage[]
  estimatedFee: string
  walletBalance: string
  validUntil: number
}
export type TransferAuthorization = (review: Readonly<TransferReview>) => Promise<boolean>
export interface TransferHost {
  identity(): WalletIdentitySnapshot
  contract(): SupportedWalletContract
  session(): number
  signal?(): AbortSignal
  assertReady(): void
  provider(): WalletBridgePort
  withSecret<T>(operation: (key: Buffer) => T): Promise<T>
  changed(operation: WalletOperation): void
  submissionFailed?(error: unknown): void
  timing?(phase: string, durationMs: number, source?: 'receipt' | 'fallback'): void
}
export function normalizedExternalHash(boc: string): string {
  const msg = loadMessage(Cell.fromBase64(boc).beginParse())
  if (msg.info.type !== 'external-in') throw new Error('Expected external message')
  return beginCell()
    .storeUint(2, 2)
    .storeAddress(null)
    .storeAddress(msg.info.dest)
    .storeCoins(0)
    .storeBit(false)
    .storeBit(true)
    .storeRef(msg.body)
    .endCell()
    .hash()
    .toString('hex')
}
function messagesFor(intent: TransferIntent): MessageRelaxed[] {
  if (
    !intent.operationId ||
    intent.operationId.length > 256 ||
    intent.messages.length < 1 ||
    intent.messages.length > 4
  )
    throw new WalletEngineError('INVALID_TRANSFER', 'Invalid transfer request')
  return intent.messages.map((message) => {
    if (!/^\d+$/.test(message.amount)) throw new WalletEngineError('INVALID_AMOUNT', 'Invalid amount')
    const address = Address.parse(message.address)
    if (address.workChain !== 0) throw new WalletEngineError('INVALID_RECIPIENT', 'Unsupported workchain')
    if ((message.payload?.length ?? 0) > 131072 || (message.stateInit?.length ?? 0) > 131072)
      throw new WalletEngineError('INVALID_TRANSFER', 'Payload too large')
    return internal({
      to: address,
      value: BigInt(message.amount),
      bounce: message.bounce ?? false,
      body: message.payload ? Cell.fromBase64(message.payload) : undefined,
      init: message.stateInit ? loadStateInit(Cell.fromBase64(message.stateInit).beginParse()) : undefined,
    })
  })
}
export class WalletTransfers {
  private active: { id: string; hash: string; promise: Promise<WalletOperation> } | null = null
  private resolving: Promise<void> | null = null
  constructor(
    private readonly host: TransferHost,
    private journal: OperationJournal
  ) {}
  setJournal(journal: OperationJournal): void {
    this.journal = journal
  }
  // Temporary latency diagnostics; timing failures must not affect transfers.
  private async measured<T>(phase: string, run: () => Promise<T>, source?: () => 'receipt' | 'fallback'): Promise<T> {
    const started = performance.now()
    try {
      return await run()
    } finally {
      try {
        const durationMs = Math.round(performance.now() - started)
        if (source) this.host.timing?.(phase, durationMs, source())
        else this.host.timing?.(phase, durationMs)
      } catch {
        /* diagnostics only */
      }
    }
  }
  private capture(): { identity: WalletIdentitySnapshot; session: number; signal?: AbortSignal } {
    this.host.assertReady()
    return { identity: this.host.identity(), session: this.host.session(), signal: this.host.signal?.() }
  }
  private check(token: ReturnType<WalletTransfers['capture']>): void {
    this.host.assertReady()
    if (
      this.host.session() !== token.session ||
      JSON.stringify(this.host.identity()) !== JSON.stringify(token.identity)
    )
      throw new WalletEngineError('IDENTITY_CHANGED', 'Wallet session changed')
  }
  private observed<T>(promise: Promise<T>, token: ReturnType<WalletTransfers['capture']>): Promise<T> {
    const signal = token.signal
    if (!signal) return promise
    if (signal.aborted) {
      void promise.catch(() => undefined)
      return Promise.reject(new WalletEngineError('IDENTITY_CHANGED', 'Wallet session changed'))
    }
    return new Promise((resolve, reject) => {
      const abort = () => {
        signal.removeEventListener('abort', abort)
        reject(new WalletEngineError('IDENTITY_CHANGED', 'Wallet session changed'))
      }
      signal.addEventListener('abort', abort, { once: true })
      void promise.then(
        (value) => {
          signal.removeEventListener('abort', abort)
          resolve(value)
        },
        (error) => {
          signal.removeEventListener('abort', abort)
          reject(error)
        }
      )
    })
  }
  private async chain(token: ReturnType<WalletTransfers['capture']>, prepareEmulation = false) {
    const snapshot = await this.observed(
      this.host.provider().getWalletSnapshot(token.identity.addressRaw, prepareEmulation),
      token
    )
    return this.validateSnapshot(snapshot, token)
  }
  private accountSeqno(
    account: WalletConfirmationReceipt['account'],
    token: ReturnType<WalletTransfers['capture']>
  ): number {
    this.check(token)
    if (!Address.parse(account.address).equals(Address.parse(token.identity.addressRaw)) || account.status === 'frozen')
      throw new WalletEngineError('INVALID_ACCOUNT', 'Wallet account is unavailable')
    if (account.status !== 'active') return 0
    const contract = this.host.contract()
    if (account.code_hash !== contract.init.code?.hash().toString('hex') || !account.data_boc)
      throw new WalletEngineError('INVALID_ACCOUNT', 'Wallet contract changed')
    const data = Cell.fromBase64(account.data_boc).beginParse()
    if ('walletId' in contract && typeof contract.walletId === 'object') data.skip(1)
    const seqno = data.loadUint(32)
    data.skip(32)
    if (data.loadBuffer(32).toString('hex') !== token.identity.publicKey)
      throw new WalletEngineError('INVALID_ACCOUNT', 'Wallet signing key changed')
    return seqno
  }
  private validateSnapshot(snapshot: WalletChainSnapshot, token: ReturnType<WalletTransfers['capture']>) {
    const seqno = this.accountSeqno(snapshot, token)
    if (snapshot.status === 'active' && seqno !== snapshot.seqno)
      throw new WalletEngineError('INVALID_ACCOUNT', 'Inconsistent wallet state')
    return snapshot
  }
  private receiptState(receipt: WalletConfirmationReceipt, token: ReturnType<WalletTransfers['capture']>) {
    if (
      receipt.account.status !== 'active' ||
      receipt.masterchain.workchain !== -1 ||
      !Number.isSafeInteger(receipt.masterchain.seqno) ||
      receipt.masterchain.seqno < 0 ||
      receipt.transactions.length < 1 ||
      receipt.transactions.length > 100
    )
      throw new WalletEngineError('INVALID_EVIDENCE', 'Incomplete wallet confirmation receipt')
    return {
      ...receipt.account,
      seqno: this.accountSeqno(receipt.account, token),
      masterchain: receipt.masterchain,
      block_time: 0,
    }
  }
  async previewTransfer(intent: TransferIntent): Promise<TransferReview> {
    const token = this.capture()
    return (await this.prepareTransfer(intent, token)).review
  }
  private async prepareTransfer(
    intent: TransferIntent,
    token: ReturnType<WalletTransfers['capture']>,
    revalidate = false
  ) {
    try {
      return await this.loadTransferReview(intent, token, revalidate)
    } catch (error) {
      this.check(token)
      if (error instanceof WalletEngineError) throw error
      const failure = new WalletEngineError(
        'TRANSFER_PREFLIGHT_FAILED',
        'Unable to verify transaction fees and recipient',
        true
      )
      failure.cause = error
      throw failure
    }
  }
  private async loadTransferReview(
    intent: TransferIntent,
    token: ReturnType<WalletTransfers['capture']>,
    revalidate: boolean
  ) {
    const messages = messagesFor(intent)
    const phase = revalidate ? 'revalidation' : 'preparation'
    const [snapshot, destinations] = await this.observed(
      Promise.all([
        this.measured(`${phase}-state-read`, () => this.chain(token, true)),
        Promise.all(
          messages.map(async (message) => {
            const info = message.info
            if (info.type !== 'internal') throw new Error('Expected internal message')
            if (!info.bounce) return 'unknown'
            const destination = await this.host.provider().getAccountInformation(info.dest.toString())
            this.check(token)
            if (destination.status !== 'active')
              throw new WalletEngineError('INVALID_RECIPIENT', 'Bounceable recipient is not an active contract')
            return destination.status
          })
        ),
      ]),
      token
    )
    this.check(token)
    const validUntil = Math.min(
      snapshot.block_time + (intent.timeoutSeconds ?? 300),
      intent.validUntil ?? Number.MAX_SAFE_INTEGER
    )
    if (
      !Number.isSafeInteger(validUntil) ||
      validUntil <= snapshot.block_time ||
      (intent.timeoutSeconds ?? 300) > 300 ||
      (intent.timeoutSeconds ?? 300) < 1
    )
      throw new WalletEngineError('TRANSFER_EXPIRED', 'Transaction expired')
    const first = messages[0].info
    if (first.type !== 'internal') throw new Error('Expected internal message')
    if (!snapshot.emulation_context) throw new Error('Verified wallet emulation context is unavailable')
    const preview = await preflightTonTransfer({
      walletContract: this.host.contract(),
      destinationBounceable: first.bounce,
      destinationStatus: destinations[0],
      walletBalance: snapshot.balance,
      message: messages[0],
      messages,
      seqno: snapshot.seqno,
      validUntil,
      emulateTransaction: (address, boc) =>
        this.measured(`${phase}-emulation-rpc`, () =>
          this.observed(
            this.host.provider().emulateTransaction(address, boc, {
              id: snapshot.emulation_context!,
              revalidate,
            }),
            token
          )
        ),
    })
    this.check(token)
    if (revalidate && !preview.signingSnapshot) throw new Error('Fresh wallet signing state is unavailable')
    const signingSnapshot = preview.signingSnapshot ? this.validateSnapshot(preview.signingSnapshot, token) : snapshot
    const fee = BigInt(preview.estimatedFee)
    const total = intent.messages.reduce((sum, msg) => sum + BigInt(msg.amount), 0n)
    if (total + fee > BigInt(snapshot.balance))
      throw new WalletEngineError('INSUFFICIENT_BALANCE', 'Insufficient balance')
    const review: TransferReview = {
      operationId: intent.operationId,
      identity: token.identity,
      messages: structuredClone(intent.messages),
      estimatedFee: fee.toString(),
      walletBalance: snapshot.balance,
      validUntil,
    }
    return { review, snapshot, signingSnapshot }
  }
  sendTransfer(
    intent: TransferIntent,
    authorize?: TransferAuthorization,
    waitForConfirmation = true,
    signal?: AbortSignal
  ): Promise<WalletOperation> {
    return this.execute(intent, 'direct', authorize, waitForConfirmation, signal)
  }
  signForRelay(intent: TransferIntent, authorize?: TransferAuthorization): Promise<WalletOperation> {
    return this.execute(intent, 'relay', authorize)
  }
  private execute(
    input: TransferIntent,
    mode: 'direct' | 'relay',
    authorize?: TransferAuthorization,
    waitForConfirmation = true,
    signal?: AbortSignal
  ): Promise<WalletOperation> {
    this.host.assertReady()
    const intent = structuredClone(input)
    messagesFor(intent)
    intent.messages = intent.messages.map((message) => ({
      address: Address.parse(message.address).toRawString(),
      amount: BigInt(message.amount).toString(),
      bounce: message.bounce ?? false,
      ...(message.payload ? { payload: Cell.fromBase64(message.payload).toBoc().toString('base64') } : {}),
      ...(message.stateInit ? { stateInit: Cell.fromBase64(message.stateInit).toBoc().toString('base64') } : {}),
    }))
    const hash = intentFingerprint([
      mode,
      intent.messages,
      intent.timeoutSeconds ?? 300,
      intent.validUntil ?? null,
      intent.context ?? null,
    ])
    if (this.active) {
      if (this.active.id === intent.operationId && this.active.hash === hash) return this.active.promise
      return Promise.reject(new WalletEngineError('SEND_IN_PROGRESS', 'A wallet operation is already active', true))
    }
    const promise = this.perform(intent, hash, mode, authorize, waitForConfirmation, signal).finally(() => {
      if (this.active?.promise === promise) this.active = null
    })
    this.active = { id: intent.operationId, hash, promise }
    return promise
  }
  private async perform(
    intent: TransferIntent,
    hash: string,
    mode: 'direct' | 'relay',
    authorize?: TransferAuthorization,
    waitForConfirmation = true,
    signal?: AbortSignal
  ): Promise<WalletOperation> {
    const token = this.capture()
    signal?.throwIfAborted()
    const approvalToken = signal
      ? { ...token, signal: AbortSignal.any([signal, ...(token.signal ? [token.signal] : [])]) }
      : token
    if (!authorize && !this.journal.get(intent.operationId))
      throw new WalletEngineError('AUTHORIZATION_REQUIRED', 'Transfer authorization is required')
    if (!this.journal.isOpen())
      throw new WalletEngineError('JOURNAL_LOCKED', 'Unlock the wallet to read its operation journal')
    const existing = this.journal.get(intent.operationId)
    if (existing) {
      if (existing.intentHash !== hash) throw new WalletEngineError('OPERATION_CONFLICT', 'Operation content changed')
      return existing
    }
    if (this.journal.pending()) {
      await this.resolvePending()
      this.check(token)
      if (this.journal.pending())
        throw new WalletEngineError('TRANSACTION_PENDING', 'An earlier wallet operation is unresolved', true)
    }
    // Host callbacks run without holding the vault/lifecycle mutation queue.
    let prepared = await this.prepareTransfer(intent, token)
    let snapshot: Awaited<ReturnType<WalletTransfers['chain']>>
    for (;;) {
      signal?.throwIfAborted()
      this.check(token)
      if (!authorize || !(await this.observed(authorize(structuredClone(prepared.review)), approvalToken)))
        throw new WalletEngineError('USER_CANCELLED', 'Transfer cancelled')
      this.check(token)
      const fresh = await this.measured('revalidation', () =>
        this.prepareTransfer({ ...intent, validUntil: prepared.review.validUntil }, token, true)
      )
      this.check(token)
      snapshot = fresh.signingSnapshot
      if (
        BigInt(fresh.review.estimatedFee) > BigInt(prepared.review.estimatedFee) ||
        snapshot.seqno !== fresh.snapshot.seqno
      ) {
        prepared = fresh
        continue
      }
      prepared = fresh
      break
    }
    const review = prepared.review
    if (review.validUntil <= snapshot.block_time) throw new WalletEngineError('TRANSFER_EXPIRED', 'Transaction expired')
    const total = intent.messages.reduce((sum, message) => sum + BigInt(message.amount), 0n)
    if (total + BigInt(review.estimatedFee) > BigInt(snapshot.balance))
      throw new WalletEngineError('INSUFFICIENT_BALANCE', 'Insufficient balance')
    const signed = await this.host.withSecret((secretKey) => {
      signal?.throwIfAborted()
      this.check(token)
      return buildExternalWalletBoc({
        walletContract: this.host.contract(),
        secretKey,
        messages: messagesFor(intent),
        seqno: snapshot.seqno,
        maxTimeout: intent.timeoutSeconds ?? 300,
        validUntil: review.validUntil,
      })
    })
    this.check(token)
    let op: WalletOperation = {
      id: intent.operationId,
      intentHash: hash,
      account: `mainnet:${token.identity.addressRaw}`,
      phase: 'ready',
      context: intent.context,
      requestHash: intent.requestHash,
      comment: intent.comment,
      commentEncrypted: intent.commentEncrypted,
      messages: structuredClone(intent.messages),
      estimatedFee: review.estimatedFee,
      seqno: signed.seqno,
      validUntil: signed.validUntil,
      boc: signed.boc,
      messageHash: Cell.fromBase64(signed.boc).hash().toString('hex'),
      normalizedHash: normalizedExternalHash(signed.boc),
      startedAt: snapshot.block_time * 1000,
      baselineLt: snapshot.last_tx_lt,
      baselineHash: snapshot.last_tx_hash,
      closed: false,
    }
    await this.journal.save(op)
    this.check(token)
    op = { ...op, phase: mode === 'relay' ? 'handed-off' : 'submitting' }
    await this.journal.save(op)
    this.check(token)
    if (mode === 'direct') {
      this.host.changed(op)
      this.check(token)
      let accepted!: (operation: WalletOperation) => void
      const submitted = new Promise<WalletOperation>((resolve) => {
        accepted = resolve
      })
      const completion = this.finishSubmission(op, token, accepted)
      if (!waitForConfirmation)
        void completion.catch((error) => {
          if (this.host.session() === token.session) this.reportSubmissionFailure(error)
        })
      return waitForConfirmation ? completion : Promise.race([submitted, completion])
    }
    this.host.changed(op)
    return op
  }
  private async finishSubmission(
    operation: WalletOperation,
    token: ReturnType<WalletTransfers['capture']>,
    accepted?: (operation: WalletOperation) => void
  ): Promise<WalletOperation> {
    let op = operation
    let result: string | WalletConfirmationReceipt | undefined
    try {
      result = await this.observed(
        this.host.provider().sendAndWatch(Buffer.from(op.boc!, 'base64'), async (hash) => {
          this.check(token)
          if (hash !== operation.messageHash)
            throw new WalletEngineError(
              'INVALID_EVIDENCE',
              'Broadcast acknowledgement does not match the signed message'
            )
          await this.journal.save({ ...op, phase: 'submitted' })
          this.check(token)
          op = this.journal.get(op.id) ?? op
          this.host.changed(op)
          this.check(token)
          accepted?.(op)
        }),
        token
      )
      this.check(token)
      op = this.journal.get(op.id) ?? op
      if (!op.closed && op.phase === 'submitting') op = { ...op, phase: 'submitted' }
    } catch (error) {
      this.check(token)
      op = this.journal.get(op.id) ?? op
      if (!op.closed && op.phase !== 'submitted') op = { ...op, phase: 'unknown' }
      this.reportSubmissionFailure(error)
    }
    let source: 'receipt' | 'fallback' = 'fallback'
    await this.measured(
      'reconciliation',
      async () => {
        await this.journal.save(op)
        this.check(token)
        if (typeof result === 'object' && result) {
          try {
            if (await this.resolve(result, op.id)) source = 'receipt'
          } catch (error) {
            this.check(token)
            this.reportSubmissionFailure(error)
          }
        }
        this.check(token)
        const current = this.journal.get(op.id)
        if (current && isOperationPending(current)) {
          source = 'fallback'
          await this.resolveAfterSubmission(token)
        }
      },
      () => source
    )
    this.check(token)
    const current = this.journal.get(op.id) ?? op
    this.host.changed(current)
    return current
  }
  private reportSubmissionFailure(error: unknown): void {
    try {
      this.host.submissionFailed?.(error)
    } catch {
      /* diagnostics only */
    }
  }
  async retryOperation(id: string, authorize: TransferAuthorization): Promise<WalletOperation> {
    const token = this.capture()
    const op = this.journal.get(id)
    if (!op?.boc) throw new WalletEngineError('OPERATION_UNAVAILABLE', 'Signed operation is unavailable')
    await this.resolvePending()
    this.check(token)
    const current = this.journal.get(id)!
    if (!isOperationPending(current)) return current
    if (current.phase === 'handed-off')
      throw new WalletEngineError('RELAY_OPERATION', 'Only the original relay may receive this operation')
    const snapshot = await this.chain(token)
    if (snapshot.seqno !== current.seqno || snapshot.block_time >= current.validUntil)
      throw new WalletEngineError('TRANSACTION_PENDING', 'Resolve this operation before retrying', true)
    const review = await this.previewTransfer({
      operationId: id,
      messages: current.messages,
      validUntil: current.validUntil,
    })
    if (!(await this.observed(authorize(structuredClone(review)), token)))
      throw new WalletEngineError('USER_CANCELLED', 'Retry cancelled')
    this.check(token)
    const finalSnapshot = await this.chain(token)
    if (finalSnapshot.seqno !== current.seqno || finalSnapshot.block_time >= current.validUntil) {
      await this.resolvePending()
      throw new WalletEngineError(
        'TRANSACTION_PENDING',
        'The signed operation changed while approval was pending',
        true
      )
    }
    this.check(token)
    await this.journal.save({ ...current, phase: 'submitting' })
    this.check(token)
    const stored = this.journal.get(current.id) ?? current
    if (stored.closed) return stored
    this.host.changed(stored)
    this.check(token)
    return this.finishSubmission({ ...current, phase: 'submitting' }, token)
  }
  private async resolveAfterSubmission(token: ReturnType<WalletTransfers['capture']>): Promise<void> {
    const earlier = this.resolving
    if (earlier) await earlier.catch(() => undefined)
    this.check(token)
    await this.resolvePending().catch(() => undefined)
    this.check(token)
  }
  resolvePending(): Promise<void> {
    if (this.resolving) return this.resolving
    this.resolving = this.resolve()
      .then(() => undefined)
      .finally(() => {
        this.resolving = null
      })
    return this.resolving
  }
  private async resolve(receipt?: WalletConfirmationReceipt, operationId?: string): Promise<boolean> {
    if (!this.journal.isOpen()) return false
    const token = this.capture()
    const operation = this.journal.pending()
    if (!operation || (operationId && operation.id !== operationId)) return false
    const snapshot = receipt ? this.receiptState(receipt, token) : await this.chain(token)
    if (receipt && snapshot.seqno <= operation.seqno)
      throw new WalletEngineError('INVALID_EVIDENCE', 'Confirmation receipt does not prove seqno consumption')
    if (operation.phase === 'legacy-pending') {
      if (snapshot.seqno > operation.seqno || snapshot.block_time > operation.validUntil + 60) {
        const next: WalletOperation = {
          ...operation,
          phase: snapshot.seqno > operation.seqno ? 'seqno-consumed' : 'expired',
          closed: true,
        }
        await this.journal.save(next)
        this.check(token)
        this.host.changed(this.journal.get(next.id) ?? next)
      }
      return false
    }
    const resume =
      !receipt && operation.scan?.headLt === snapshot.last_tx_lt && operation.scan.headHash === snapshot.last_tx_hash
        ? operation.scan
        : undefined
    let lt = resume?.nextLt ?? snapshot.last_tx_lt
    let hash = resume?.nextHash ?? snapshot.last_tx_hash
    let complete = lt === operation.baselineLt && hash === operation.baselineHash
    // Bound each sweep. Incomplete/archive-unavailable history never proves absence.
    for (let page = 0; page < 20 && !complete && lt !== '0'; page++) {
      const transactions = receipt
        ? page === 0
          ? receipt.transactions
          : []
        : await this.host
            .provider()
            .getRawTransactions(token.identity.addressRaw, 100, lt, hash, snapshot.masterchain.seqno)
      this.check(token)
      if (transactions.length === 0) return false
      const ordered = [...transactions].sort((a, b) => (BigInt(a.lt) > BigInt(b.lt) ? -1 : 1))
      for (const record of ordered) {
        if (record.lt === operation.baselineLt && record.hash === operation.baselineHash) {
          complete = true
          break
        }
        if (record.lt !== lt || record.hash !== hash || !record.boc) return false
        const tx = loadTransaction(Cell.fromBase64(record.boc).beginParse())
        if (
          tx.hash().toString('hex') !== hash ||
          tx.lt.toString() !== lt ||
          tx.address !== BigInt('0x' + Address.parse(token.identity.addressRaw).hash.toString('hex'))
        )
          throw new WalletEngineError('INVALID_EVIDENCE', 'Invalid transaction evidence')
        const incoming = tx.inMessage
        if (incoming?.info.type === 'external-in') {
          const normalized = beginCell()
            .storeUint(2, 2)
            .storeAddress(null)
            .storeAddress(incoming.info.dest)
            .storeCoins(0)
            .storeBit(false)
            .storeBit(true)
            .storeRef(incoming.body)
            .endCell()
            .hash()
            .toString('hex')
          if (normalized === operation.normalizedHash) {
            let execution: WalletOperation['execution'] = 'unknown'
            if (tx.description.type === 'generic') {
              const description = tx.description
              const actions = description.actionPhase
              if (
                description.aborted ||
                description.computePhase.type !== 'vm' ||
                !description.computePhase.success ||
                (actions && (!actions.success || !actions.valid || actions.noFunds || actions.resultCode !== 0))
              )
                execution = 'failed'
              else if (actions)
                execution =
                  actions.skippedActions || actions.messagesCreated !== operation.messages.length
                    ? 'partial'
                    : 'succeeded'
            }
            const included: WalletOperation = {
              ...operation,
              phase: 'included',
              transactionHash: hash,
              transactionLt: lt,
              execution,
              closed: snapshot.seqno > operation.seqno || snapshot.block_time > operation.validUntil + 60,
            }
            await this.journal.save(included)
            this.check(token)
            const stored = this.journal.get(included.id) ?? included
            const includedHere = stored.phase === 'included' && stored.transactionHash === hash
            this.host.changed(stored)
            return includedHere
          }
        }
        lt = tx.prevTransactionLt.toString()
        hash = tx.prevTransactionHash.toString(16).padStart(64, '0')
        if (lt === operation.baselineLt && (lt === '0' || hash === operation.baselineHash)) {
          complete = true
          break
        }
      }
    }
    if (receipt) return false
    if (lt === '0' && operation.baselineLt === '0') complete = true
    if (!complete) {
      if (lt !== snapshot.last_tx_lt)
        await this.journal.save({
          ...operation,
          scan: { headLt: snapshot.last_tx_lt, headHash: snapshot.last_tx_hash, nextLt: lt, nextHash: hash },
        })
      return false
    }
    // Re-observe after the scan: a transaction committed between reads invalidates absence.
    const after = await this.chain(token)
    if (after.last_tx_lt !== snapshot.last_tx_lt || after.last_tx_hash !== snapshot.last_tx_hash) return false
    let next: WalletOperation | null = null
    if (after.seqno > operation.seqno)
      next = { ...operation, phase: 'seqno-consumed', execution: 'unknown', closed: true }
    else if (after.seqno === operation.seqno && after.block_time > operation.validUntil + 60)
      next = { ...operation, phase: 'expired', closed: true }
    if (next) {
      await this.journal.save(next)
      this.check(token)
      this.host.changed(this.journal.get(next.id) ?? next)
    }
    return false
  }
  newOperationId(): string {
    return randomUUID()
  }
}
