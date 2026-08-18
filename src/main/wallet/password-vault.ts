import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback } from 'node:crypto'
import { z } from 'zod'

const AAD = Buffer.from('ton-browser-wallet-v2', 'utf8')
const SCRYPT_N = 1 << 15
const SCRYPT_R = 8
const SCRYPT_P = 3
const SCRYPT_MAXMEM = 128 * 1024 * 1024

export const WalletSecretSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mnemonic'), mnemonic: z.array(z.string().min(1)).length(24) }),
  z.object({ type: z.literal('seed'), seed: z.string().regex(/^[a-fA-F0-9]{64}$/) }),
])
export type WalletSecret = z.infer<typeof WalletSecretSchema>

export const PasswordEnvelopeSchema = z.object({
  type: z.literal('password'),
  publicKey: z.string().regex(/^[a-fA-F0-9]{64}$/),
  backupVerified: z.boolean().default(false),
  kdf: z.object({
    name: z.literal('scrypt'),
    salt: z.string(),
    n: z.literal(SCRYPT_N),
    r: z.literal(SCRYPT_R),
    p: z.literal(SCRYPT_P),
  }),
  cipher: z.object({
    name: z.literal('aes-256-gcm'),
    iv: z.string(),
    tag: z.string(),
    ciphertext: z.string(),
  }),
})
export type PasswordEnvelope = z.infer<typeof PasswordEnvelopeSchema>

export function validateWalletPassword(password: string): void {
  if (typeof password !== 'string' || password.length < 10 || password.length > 256) {
    throw new Error('Wallet password must be between 10 and 256 characters')
  }
}

async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password.normalize('NFKC'),
      salt,
      32,
      {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: SCRYPT_MAXMEM,
      },
      (error, key) => {
        if (error) reject(error)
        else resolve(Buffer.from(key))
      }
    )
  })
}

export async function encryptWalletSecret(
  secret: WalletSecret,
  password: string,
  publicKey: Buffer,
  backupVerified = false
): Promise<PasswordEnvelope> {
  validateWalletPassword(password)
  const validated = WalletSecretSchema.parse(secret)
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = await deriveKey(password, salt)
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(AAD)
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(validated), 'utf8'), cipher.final()])
    return {
      type: 'password',
      publicKey: publicKey.toString('hex'),
      backupVerified,
      kdf: { name: 'scrypt', salt: salt.toString('base64'), n: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
      cipher: {
        name: 'aes-256-gcm',
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64'),
      },
    }
  } finally {
    key.fill(0)
  }
}

export async function decryptWalletSecret(envelope: PasswordEnvelope, password: string): Promise<WalletSecret> {
  validateWalletPassword(password)
  const parsed = PasswordEnvelopeSchema.parse(envelope)
  const salt = Buffer.from(parsed.kdf.salt, 'base64')
  const key = await deriveKey(password, salt)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.cipher.iv, 'base64'))
    decipher.setAAD(AAD)
    decipher.setAuthTag(Buffer.from(parsed.cipher.tag, 'base64'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(parsed.cipher.ciphertext, 'base64')),
      decipher.final(),
    ])
    try {
      return WalletSecretSchema.parse(JSON.parse(plaintext.toString('utf8')))
    } finally {
      plaintext.fill(0)
    }
  } finally {
    key.fill(0)
  }
}
