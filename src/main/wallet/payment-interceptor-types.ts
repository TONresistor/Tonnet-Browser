import type { PaymentNotificationData, PaymentRequirements } from '../../shared/types'

export interface InterceptedRequest {
  url: string
  webContentsId: number
  session: Electron.Session
}

export type PaymentNotificationSink = (notification: PaymentNotificationData) => void

export interface PendingPaymentApproval {
  request: InterceptedRequest
  paymentReq: PaymentRequirements
  domain: string
  ttl: ReturnType<typeof setTimeout>
  reservationId?: string
  xhrResolver?: (result: { success: boolean; error?: string }) => void
}
