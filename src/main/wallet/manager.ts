import { WalletEngine, type WalletBridgePort, type BridgeProvider } from '../../wallet-engine'
import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { SafeStorageWrapper } from '../history/safe-storage-wrapper'
import { z } from 'zod'
import type { ISecureStorage } from '../ports/secure-storage'
import { ElectronSafeStorageAdapter } from '../adapters/electron-secure-storage'
import { writeSecureFileAtomic } from '../utils/secure-fs'
import { deleteWalletStorage, getWalletStorageFingerprint, quarantineWalletStorage } from './wallet-storage-quarantine'
import { FileOperationJournalStore } from './journal-store'
import { WalletHistoryManager } from './history'
import { getSetting } from '../settings'
import { createLogger } from '../../shared/logger'
import type { PaymentRequirements, ExactTonPayload } from '../../shared/types'
import type { WalletIdentitySnapshot } from '../../wallet-engine'
export class WalletManager extends WalletEngine {
  constructor(
    storage: ISecureStorage = new ElectronSafeStorageAdapter(),
    bridge: BridgeProvider<WalletBridgePort> = { getBridge: () => null, onBridgeChanged: () => () => {} },
    history = new WalletHistoryManager(),
    fallbackHistory?: (address: string, limit: number) => Promise<import('../../shared/types').WalletTransaction[]>
  ) {
    const legacyLeases = new SafeStorageWrapper('wallet-seqno-leases', {
      version: 1,
      migrate: (raw) => raw,
      parse: (raw) =>
        z
          .object({
            leases: z.record(
              z.string(),
              z.object({ seqno: z.number().int().nonnegative(), validUntil: z.number().int().positive() })
            ),
          })
          .parse(raw),
    })
    super({
      legacyPending: async () => (await legacyLeases.read())?.leases ?? {},
      logger: createLogger('wallet'),
      secureStorage: storage,
      bridge,
      history,
      fallbackHistory,
      autoLockMinutes: getSetting('wallet').autoLockMinutes,
      vault: {
        filePath: join(app.getPath('userData'), 'wallet-key.dat'),
        files: fs,
        writeAtomic: writeSecureFileAtomic,
        delete: deleteWalletStorage,
        fingerprint: getWalletStorageFingerprint,
        quarantine: (path, paths, fingerprint) =>
          quarantineWalletStorage(path, [...paths, join(app.getPath('userData'), 'wallet-operations')], fingerprint),
      },
      journal: new FileOperationJournalStore(),
    })
  }
  async signX402Payment(
    requirements: PaymentRequirements,
    identity: WalletIdentitySnapshot,
    operationId = randomUUID(),
    expectedSession?: number
  ): Promise<ExactTonPayload> {
    if (expectedSession !== undefined && expectedSession !== this.getSessionRevision())
      throw new Error('Wallet session changed')
    const current = this.getIdentitySnapshot()
    if (JSON.stringify(current) !== JSON.stringify(identity)) throw new Error('Wallet identity changed')
    const op = await this.signForRelay(
      {
        operationId,
        context: 'x402',
        timeoutSeconds: requirements.maxTimeoutSeconds,
        messages: [{ address: requirements.payTo, amount: requirements.amount, bounce: false }],
      },
      async () => true
    )
    if (!op.boc || ['included', 'expired', 'seqno-consumed'].includes(op.phase))
      throw new Error('Payment operation is already resolved')
    return {
      signedBoc: op.boc,
      walletPublicKey: identity.publicKey,
      walletAddress: identity.addressRaw,
      seqno: op.seqno,
      validUntil: op.validUntil,
    }
  }
}
