import { WalletHistoryManager as CoreHistory, WalletTransactionSchema } from '../../wallet-engine'
import { SafeStorageWrapper } from '../history/safe-storage-wrapper'
import { z } from 'zod'
import { createLogger } from '../../shared/logger'
export class WalletHistoryManager extends CoreHistory {
  constructor() {
    super(
      new SafeStorageWrapper('wallet-history', {
        version: 1,
        migrate: (raw) => raw,
        parse: (raw) => z.array(WalletTransactionSchema).parse(raw),
      }),
      createLogger('wallet:history')
    )
  }
}
