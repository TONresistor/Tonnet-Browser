import type { Address, StateInit } from '@ton/core'
import { WalletContractV3R1, WalletContractV3R2, WalletContractV4, WalletContractV5R1 } from '@ton/ton'
import { keyPairFromSeed, mnemonicToPrivateKey, mnemonicValidate } from '@ton/crypto'
import { z } from 'zod'
import { mnemonicToSeedSync, validateMnemonic as validateBip39Mnemonic } from 'bip39'
import { derivePath } from 'ed25519-hd-key'

export const WalletVersionSchema = z.enum(['v3R1', 'v3R2', 'v4R2', 'v5R1'])
export type WalletVersion = z.infer<typeof WalletVersionSchema>
export const MnemonicSchemeSchema = z.enum(['ton', 'bip39'])
export type MnemonicScheme = z.infer<typeof MnemonicSchemeSchema>

export type SupportedWalletContract = WalletContractV3R1 | WalletContractV3R2 | WalletContractV4 | WalletContractV5R1

export interface WalletContractShape {
  address: Address
  init: StateInit
  createTransfer(args: Record<string, unknown>): unknown
}

export interface WalletAccountCandidate {
  scheme: MnemonicScheme
  version: WalletVersion
  address: string
  addressRaw: string
  balance: string | null
}

export async function detectMnemonicSchemes(mnemonic: string[]): Promise<MnemonicScheme[]> {
  const phrase = mnemonic.join(' ')
  const schemes: MnemonicScheme[] = []
  if (mnemonic.length === 24 && (await mnemonicValidate(mnemonic))) schemes.push('ton')
  if ((mnemonic.length === 12 || mnemonic.length === 24) && validateBip39Mnemonic(phrase)) schemes.push('bip39')
  return schemes
}

export async function deriveWalletKeyPair(mnemonic: string[], scheme: MnemonicScheme) {
  if (scheme === 'ton') return mnemonicToPrivateKey(mnemonic)
  const seed = mnemonicToSeedSync(mnemonic.join(' '))
  try {
    const derived = Buffer.from(derivePath("m/44'/607'/0'", seed.toString('hex')).key)
    try {
      return keyPairFromSeed(derived)
    } finally {
      derived.fill(0)
    }
  } finally {
    seed.fill(0)
  }
}

export function createWalletContract(
  version: WalletVersion,
  publicKey: Buffer,
  workchain = 0
): SupportedWalletContract {
  switch (version) {
    case 'v3R1':
      return WalletContractV3R1.create({ publicKey, workchain })
    case 'v3R2':
      return WalletContractV3R2.create({ publicKey, workchain })
    case 'v4R2':
      return WalletContractV4.create({ publicKey, workchain })
    case 'v5R1':
      return WalletContractV5R1.create({ publicKey, workchain })
  }
}

export async function discoverWalletAccounts(
  mnemonic: string[],
  bridge: { getBalance(address: string): Promise<string> }
): Promise<WalletAccountCandidate[]> {
  const schemes = await detectMnemonicSchemes(mnemonic)
  if (schemes.length === 0) throw new Error('Invalid mnemonic phrase')
  const candidates: WalletAccountCandidate[] = []
  for (const scheme of schemes) {
    const keypair = await deriveWalletKeyPair(mnemonic, scheme)
    try {
      candidates.push(
        ...(await Promise.all(
          WalletVersionSchema.options.map(async (version) => {
            const contract = createWalletContract(version, keypair.publicKey)
            let balance: string | null = null
            try {
              balance = await bridge.getBalance(contract.address.toString())
            } catch {
              balance = null
            }
            return {
              scheme,
              version,
              address: contract.address.toString({ bounceable: false }),
              addressRaw: contract.address.toRawString(),
              balance,
            }
          })
        ))
      )
    } finally {
      keypair.publicKey.fill(0)
      keypair.secretKey.fill(0)
    }
  }
  return candidates
}

export async function deriveWalletAccount(
  mnemonic: string[],
  scheme: MnemonicScheme,
  version: WalletVersion
): Promise<Omit<WalletAccountCandidate, 'balance'>> {
  if (!(await detectMnemonicSchemes(mnemonic)).includes(scheme)) throw new Error('Invalid mnemonic phrase')
  const keypair = await deriveWalletKeyPair(mnemonic, scheme)
  try {
    const contract = createWalletContract(version, keypair.publicKey)
    return {
      scheme,
      version,
      address: contract.address.toString({ bounceable: false }),
      addressRaw: contract.address.toRawString(),
    }
  } finally {
    keypair.publicKey.fill(0)
    keypair.secretKey.fill(0)
  }
}
