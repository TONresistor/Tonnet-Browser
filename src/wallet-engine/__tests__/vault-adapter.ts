import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { WalletKeyStorage as CoreVault } from '../key-storage'
import type { SecureStorage } from '../ports'
import { writeSecureFileAtomic } from '../../main/utils/secure-fs'
import {
  deleteWalletStorage,
  getWalletStorageFingerprint,
  quarantineWalletStorage,
} from '../../main/wallet/wallet-storage-quarantine'
export { WalletDecryptionError, WalletSystemStorageError } from '../key-storage'
export class WalletKeyStorage extends CoreVault {
  constructor(storage: SecureStorage, directory = '/tmp/test') {
    super(storage, {
      filePath: join(directory, 'wallet-key.dat'),
      files: fs,
      writeAtomic: writeSecureFileAtomic,
      delete: deleteWalletStorage,
      fingerprint: getWalletStorageFingerprint,
      quarantine: quarantineWalletStorage,
    })
  }
}
