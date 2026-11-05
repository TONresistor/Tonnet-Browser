import type { promises as fs } from 'node:fs'
import type { WalletTransaction } from './schemas'
export interface SecureStorage {
  isAvailable(): boolean
  encrypt(plaintext: string): Buffer
  decrypt(encrypted: Buffer): string
  getBackendName(): string
}
export interface VaultPersistence {
  readonly filePath: string
  readonly files: Pick<typeof fs, 'readFile' | 'writeFile' | 'access' | 'copyFile' | 'rename' | 'chmod' | 'unlink'>
  writeAtomic(path: string, data: Buffer): Promise<void>
  delete(paths: string[]): Promise<void>
  fingerprint(path: string): Promise<string | null>
  quarantine(path: string, paths: string[], fingerprint: string): Promise<{ recoveryId: string }>
}
export interface HistoryStore {
  read(): Promise<WalletTransaction[] | null>
  write(value: WalletTransaction[]): Promise<void>
  delete(): Promise<void>
}
export interface BridgeProvider<T> {
  getBridge(): T | null
  onBridgeChanged(listener: (bridge: T | null) => void): () => void
}
export interface JournalStore {
  read(account: string): Promise<Buffer | null>
  compareExchange(account: string, expectedRevision: number, value: Buffer): Promise<void>
}
