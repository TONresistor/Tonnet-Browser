/**
 * 402 payment notification component.
 * Displays pending payment requests with approve/reject actions.
 * Supports 4 notification styles: banner, modal, toast, panel.
 */

import { useState, useEffect, useCallback } from 'react'
import { Globe, Check, X } from 'lucide-react'
import { truncateAddress } from '@/lib/format'
import { isIpcError } from '@/lib/ipc-utils'
import { formatTonAmount } from '@/stores/wallet'
import type { PaymentNotificationData, NotificationStyle } from '@shared/types'

function safeFormatAmount(s: string): string {
  if (!s || !/^\d+$/.test(s)) return '?'
  return formatTonAmount(s)
}

interface PaymentNotificationProps {
  style?: NotificationStyle
}

export function PaymentNotification({ style = 'banner' }: PaymentNotificationProps) {
  const [notifications, setNotifications] = useState<PaymentNotificationData[]>([])

  useEffect(() => {
    const unsubReq = window.electron.on('wallet:payment-req', (...args: unknown[]) => {
      const data = args[0] as PaymentNotificationData
      if (data && data.id) {
        setNotifications((prev) => [...prev, data])
      }
    })

    const unsubMade = window.electron.on('wallet:payment-made', (...args: unknown[]) => {
      const data = args[0] as PaymentNotificationData
      if (data && data.id) {
        setNotifications((prev) => prev.filter((n) => n.id !== data.id))
      }
    })

    const unsubFailed = window.electron.on('wallet:payment-failed', (...args: unknown[]) => {
      const data = args[0] as PaymentNotificationData
      if (data && data.id) {
        setNotifications((prev) => prev.filter((n) => n.id !== data.id))
      }
    })

    return () => {
      unsubReq()
      unsubMade()
      unsubFailed()
    }
  }, [])

  const handleApprove = useCallback(async (id: string) => {
    try {
      const result = await window.electron.wallet.approvePayment(id)
      if (isIpcError(result)) return
      setNotifications((prev) => prev.filter((n) => n.id !== id))
    } catch {
      // keep notification visible on error
    }
  }, [])

  const handleReject = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id))
    window.electron.wallet.rejectPayment(id)
  }, [])

  if (notifications.length === 0) return null

  if (style === 'modal') {
    const n = notifications[0]
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-card border border-border rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-warning/10 flex items-center justify-center">
              <Globe className="h-5 w-5 text-warning" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Payment Request</h3>
              <p className="text-xs text-muted-foreground">{n.domain}</p>
            </div>
          </div>

          <div className="space-y-3 mb-6">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Amount</span>
              <span className="font-medium text-foreground">{safeFormatAmount(n.amount)} TON</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">To</span>
              <span className="font-mono text-xs text-foreground">{truncateAddress(n.payTo, 8, 8)}</span>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => handleReject(n.id)}
              className="flex-1 px-4 py-2 text-sm rounded-md border border-border text-foreground hover:bg-muted transition-colors"
            >
              Reject
            </button>
            <button
              onClick={() => handleApprove(n.id)}
              className="flex-1 px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Approve
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (style === 'toast') {
    return (
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {notifications.map((n) => (
          <div key={n.id} className="bg-card border border-border rounded-lg shadow-lg p-4">
            <div className="flex items-start gap-3">
              <Globe className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{n.domain}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {safeFormatAmount(n.amount)} TON to {truncateAddress(n.payTo, 8, 8)}
                </p>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => handleReject(n.id)}
                    className="px-3 py-1 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => handleApprove(n.id)}
                    className="px-3 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    Approve
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (style === 'panel') {
    return (
      <div className="fixed right-0 top-0 bottom-0 z-50 w-80 bg-card border-l border-border shadow-xl overflow-y-auto">
        <div className="p-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Payment Requests</h3>
        </div>
        <div className="divide-y divide-border">
          {notifications.map((n) => (
            <div key={n.id} className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Globe className="h-4 w-4 text-warning" />
                <span className="text-sm font-medium text-foreground">{n.domain}</span>
              </div>
              <div className="space-y-2 mb-3">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="text-foreground">{safeFormatAmount(n.amount)} TON</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">To</span>
                  <span className="font-mono text-foreground">{truncateAddress(n.payTo, 8, 8)}</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleReject(n.id)}
                  className="flex-1 px-3 py-1.5 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors"
                >
                  Reject
                </button>
                <button
                  onClick={() => handleApprove(n.id)}
                  className="flex-1 px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  Approve
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Default: banner style
  return (
    <div className="flex flex-col gap-1">
      {notifications.map((n) => (
        <div key={n.id} className="flex items-center gap-3 px-4 py-2 bg-warning/10 border-b border-warning/20">
          <Globe className="h-4 w-4 text-warning flex-shrink-0" />
          <span className="text-xs text-foreground flex-1 min-w-0 truncate">
            <span className="font-medium">{n.domain}</span>
            {' requests '}
            <span className="font-medium">{safeFormatAmount(n.amount)} TON</span>
            {' to '}
            <span className="font-mono">{truncateAddress(n.payTo, 8, 8)}</span>
          </span>
          <div className="flex gap-1.5 flex-shrink-0">
            <button
              onClick={() => handleReject(n.id)}
              className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
              title="Reject"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => handleApprove(n.id)}
              className="p-1 rounded hover:bg-success/10 text-muted-foreground hover:text-success transition-colors"
              title="Approve"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
