export interface ISecureStorage {
  isAvailable(): boolean
  encrypt(plaintext: string): Buffer
  decrypt(encrypted: Buffer): string
  getBackendName(): string
}
