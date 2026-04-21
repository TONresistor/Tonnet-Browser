import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useOverlay } from '@/hooks/useOverlay'
import { formatTonAmount, useWalletStore } from '@/stores/wallet'
import type { PaymentNotificationData } from '@shared/types'

const OVERLAY_ID = 'wallet-payment-approval'
const OVERLAY_WIDTH = 420
const OVERLAY_HEIGHT = 320

function shortAddress(addr: string): string {
  if (addr.length <= 24) return addr
  return addr.slice(0, 8) + '…' + addr.slice(-8)
}

export function usePaymentApprovals(): void {
  const { t } = useTranslation('wallet')
  const hideRef = useRef<(() => void) | null>(null)

  const handleAction = useCallback(async (actionType: string) => {
    hideRef.current?.()
    const store = useWalletStore.getState()
    if (actionType === 'approve') {
      await store.approvePending402()
    } else {
      await store.rejectPending402()
    }
  }, [])

  const overlay = useOverlay(OVERLAY_ID, handleAction)
  hideRef.current = overlay.hide

  const show = useCallback(
    (data: PaymentNotificationData) => {
      const x = Math.max(8, Math.round((window.innerWidth - OVERLAY_WIDTH) / 2))
      const y = Math.max(8, Math.round((window.innerHeight - OVERLAY_HEIGHT) / 2))
      overlay.show(
        { x, y, width: OVERLAY_WIDTH, height: OVERLAY_HEIGHT },
        {
          type: 'form',
          title: t('payment.title'),
          fields: [
            { id: '_domain', label: t('payment.domain'), value: data.domain, readonly: true },
            { id: '_amount', label: t('payment.amount'), value: `${formatTonAmount(data.amount)} TON`, readonly: true },
            {
              id: '_recipient',
              label: t('payment.recipient'),
              value: shortAddress(data.payToFriendly || data.payTo),
              readonly: true,
            },
          ],
          actions: [
            { id: 'reject', label: t('payment.reject') },
            { id: 'approve', label: t('payment.approve'), primary: true },
          ],
        },
        { autoDismiss: true }
      )
    },
    [overlay, t]
  )

  useEffect(() => {
    const unsubReq = window.electron.on('wallet:payment-req', (...args: unknown[]) => {
      const data = args[0] as PaymentNotificationData
      if (!data || data.status !== 'pending') return
      useWalletStore.getState().setPending402Notification(data)
      if (useWalletStore.getState().notificationStyle === 'popup') {
        show(data)
      }
    })

    const resolveEvent = (args: unknown[]): void => {
      const data = args[0] as PaymentNotificationData | undefined
      const current = useWalletStore.getState().pending402Notification
      if (data?.id && current?.id === data.id) {
        useWalletStore.getState().setPending402Notification(null)
        hideRef.current?.()
      }
    }

    const unsubMade = window.electron.on('wallet:payment-made', (...args: unknown[]) => resolveEvent(args))
    const unsubFailed = window.electron.on('wallet:payment-failed', (...args: unknown[]) => resolveEvent(args))

    return () => {
      unsubReq()
      unsubMade()
      unsubFailed()
    }
  }, [show])
}
