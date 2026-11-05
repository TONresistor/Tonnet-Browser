import type {
  ExactTonPayload,
  PaymentMode,
  PaymentRequirements,
  WalletState,
  WalletTransaction,
} from '../../shared/types'
import type { WalletIdentitySnapshot } from './wallet-identity'

export interface PaymentWalletPort {
  getOperation?(id: string): import('../../wallet-engine').WalletOperation | undefined
  getState(): WalletState
  getSessionRevision(): number
  getIdentitySnapshot(): WalletIdentitySnapshot | null
  signX402Payment(
    requirements: PaymentRequirements,
    expectedIdentity: WalletIdentitySnapshot,
    operationId?: string,
    expectedSession?: number
  ): Promise<ExactTonPayload>
}

export interface PaymentPolicyPort {
  persistReservation(reservationId: string, operationId: string, account: string): Promise<void>
  getSiteMode(domain: string): PaymentMode
  reservePayment(domain: string, amountNano: string): string | null
  confirmPayment(reservationId: string): void
  rollbackPayment(reservationId: string): void
}

export interface PaymentHistoryPort {
  add(transaction: WalletTransaction): Promise<void>
  updateStatus(id: string, status: WalletTransaction['status'], hash?: string): Promise<void>
}
