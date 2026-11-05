import { z } from 'zod'
import { PasswordEnvelopeSchema, WalletSecretSchema, type PasswordEnvelope, type WalletSecret } from './password-vault'
import { MnemonicSchemeSchema, WalletVersionSchema, type MnemonicScheme, type WalletVersion } from './wallet-versions'

export const DeviceEnvelopeSchema = z.object({
  type: z.literal('device'),
  publicKey: z.string().regex(/^[a-fA-F0-9]{64}$/),
  backupVerified: z.boolean(),
  walletVersion: WalletVersionSchema,
  mnemonicScheme: MnemonicSchemeSchema,
  secret: WalletSecretSchema,
})

export type DeviceEnvelope = z.infer<typeof DeviceEnvelopeSchema>
export type StorageData = WalletSecret | DeviceEnvelope | PasswordEnvelope

const StorageDataSchema = z.union([WalletSecretSchema, DeviceEnvelopeSchema, PasswordEnvelopeSchema])
const StorageDocumentSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  data: StorageDataSchema,
})

export function parseStorageData(raw: unknown): StorageData {
  const current = StorageDocumentSchema.safeParse(raw)
  if (current.success) return current.data.data
  return StorageDataSchema.parse(raw)
}

export function encodeStorageData(data: StorageData): string {
  const validated = StorageDataSchema.parse(data)
  const schemaVersion = validated.type === 'device' ? 3 : validated.type === 'password' ? 2 : 1
  return JSON.stringify({ schemaVersion, data: validated })
}

export function createDeviceEnvelope(
  secret: WalletSecret,
  publicKey: Buffer,
  backupVerified: boolean,
  walletVersion: WalletVersion,
  mnemonicScheme: MnemonicScheme
): DeviceEnvelope {
  return DeviceEnvelopeSchema.parse({
    type: 'device',
    publicKey: publicKey.toString('hex'),
    backupVerified,
    walletVersion,
    mnemonicScheme,
    secret,
  })
}
