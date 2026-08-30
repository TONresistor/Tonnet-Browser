import type {
  ExactTonPayload,
  PaymentMode,
  PaymentRequirements,
  WalletState,
  WalletTransaction,
} from '../../shared/types'
import type { WalletIdentitySnapshot } from './wallet-identity'

export interface PaymentWalletPort {
  getState(): WalletState
  getIdentitySnapshot(): WalletIdentitySnapshot | null
  signX402Payment(requirements: PaymentRequirements, expectedIdentity: WalletIdentitySnapshot): Promise<ExactTonPayload>
}

export interface PaymentPolicyPort {
  getSiteMode(domain: string): PaymentMode
  reservePayment(domain: string, amountNano: string): string | null
  confirmPayment(reservationId: string): void
  rollbackPayment(reservationId: string): void
}

export interface PaymentHistoryPort {
  add(transaction: WalletTransaction): Promise<void>
  updateStatus(id: string, status: WalletTransaction['status'], hash?: string): Promise<void>
}
