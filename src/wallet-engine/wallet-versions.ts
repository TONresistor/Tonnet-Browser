import type { Address, StateInit } from '@ton/core'
import { WalletContractV3R1, WalletContractV3R2, WalletContractV4, WalletContractV5R1 } from '@ton/ton'
import { mnemonicToPrivateKey, mnemonicValidate } from '@ton/crypto'
import { z } from 'zod'

export const WalletVersionSchema = z.enum(['v3R1', 'v3R2', 'v4R2', 'v5R1'])
export type WalletVersion = z.infer<typeof WalletVersionSchema>
export const MnemonicSchemeSchema = z.literal('ton')
export type MnemonicScheme = z.infer<typeof MnemonicSchemeSchema>

export type SupportedWalletContract = WalletContractV3R1 | WalletContractV3R2 | WalletContractV4 | WalletContractV5R1

export interface WalletContractShape {
  address: Address
  init: StateInit
  createTransfer(args: Record<string, unknown>): unknown
}

export interface WalletAccountCandidate {
  version: WalletVersion
  address: string
  addressRaw: string
  balance: string | null
}

export async function validateTonMnemonic(mnemonic: string[]): Promise<boolean> {
  return mnemonic.length === 24 && (await mnemonicValidate(mnemonic))
}

export function deriveWalletKeyPair(mnemonic: string[]) {
  return mnemonicToPrivateKey(mnemonic)
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
  if (!(await validateTonMnemonic(mnemonic))) throw new Error('Invalid mnemonic phrase')
  const keypair = await deriveWalletKeyPair(mnemonic)
  try {
    return await Promise.all(
      WalletVersionSchema.options.map(async (version) => {
        const contract = createWalletContract(version, keypair.publicKey)
        let balance: string | null = null
        try {
          balance = await bridge.getBalance(contract.address.toString())
        } catch {
          balance = null
        }
        return {
          version,
          address: contract.address.toString({ bounceable: false }),
          addressRaw: contract.address.toRawString(),
          balance,
        }
      })
    )
  } finally {
    keypair.publicKey.fill(0)
    keypair.secretKey.fill(0)
  }
}

export async function deriveWalletAccount(
  mnemonic: string[],
  version: WalletVersion
): Promise<Omit<WalletAccountCandidate, 'balance'>> {
  if (!(await validateTonMnemonic(mnemonic))) throw new Error('Invalid mnemonic phrase')
  const keypair = await deriveWalletKeyPair(mnemonic)
  try {
    const contract = createWalletContract(version, keypair.publicKey)
    return {
      version,
      address: contract.address.toString({ bounceable: false }),
      addressRaw: contract.address.toRawString(),
    }
  } finally {
    keypair.publicKey.fill(0)
    keypair.secretKey.fill(0)
  }
}
