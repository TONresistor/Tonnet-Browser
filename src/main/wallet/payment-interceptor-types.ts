import type { PaymentNotificationData, PaymentRequirements } from '../../shared/types'
import type { WalletIdentitySnapshot } from './wallet-identity'

export interface InterceptedRequest {
  url: string
  originalOrigin?: string
  webContentsId: number
  session: Electron.Session
}

export type PaymentNotificationSink = (notification: PaymentNotificationData) => void

export interface PendingPaymentApproval {
  request: InterceptedRequest
  paymentReq: PaymentRequirements
  domain: string
  walletIdentity: WalletIdentitySnapshot
  accountGeneration: number
  ttl: ReturnType<typeof setTimeout>
  reservationId?: string
  xhrResolver?: (result: { success: boolean; error?: string }) => void
}
