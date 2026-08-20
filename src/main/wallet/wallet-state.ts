import type { WalletState } from '../../shared/types'
import type { SupportedWalletContract, WalletVersion } from './wallet-versions'

export function buildWalletState(input: {
  publicKey: Buffer | null
  contract: SupportedWalletContract | null
  balance: string
  isLocked: boolean
  decryptFailed: boolean
  weakEncryption: boolean
  needsPasswordSetup: boolean
  passwordProtected: boolean
  backupVerified: boolean
  walletVersion: WalletVersion
}): WalletState {
  const common = {
    balance: input.balance,
    isLocked: input.isLocked,
    decryptFailed: input.decryptFailed,
    weakEncryption: input.weakEncryption,
    needsPasswordSetup: input.needsPasswordSetup,
    passwordProtected: input.passwordProtected,
    backupVerified: input.backupVerified,
    walletVersion: input.walletVersion,
  }
  if (!input.publicKey || !input.contract) {
    return { ...common, isCreated: false, address: '', addressRaw: '', publicKey: '' }
  }
  return {
    ...common,
    isCreated: true,
    address: input.contract.address.toString({ bounceable: false }),
    addressRaw: input.contract.address.toRawString(),
    publicKey: input.publicKey.toString('hex'),
  }
}
