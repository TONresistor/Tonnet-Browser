import type {
  ExactTonPayload,
  PaymentMode,
  PaymentRequirements,
  WalletState,
  WalletTransaction,
} from '../../shared/types'

export interface PaymentWalletPort {
  getState(): WalletState
  signX402Payment(requirements: PaymentRequirements): Promise<ExactTonPayload>
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
