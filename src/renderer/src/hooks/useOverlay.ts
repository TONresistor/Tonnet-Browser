/**
 * Hook for overlay management.
 * Show/hide native overlays and receive user actions.
 */

import { useEffect, useCallback, useRef } from 'react'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { browserClient } from '@/features/browser/client'

interface OverlayBounds {
  x: number
  y: number
  width: number
  height: number
}

type OverlayActionCallback = (actionType: string, data: unknown) => void

export function useOverlay(id: string, onAction?: OverlayActionCallback) {
  const activeRef = useRef(false)

  useEffect(() => {
    if (!onAction) return
    const unsub = browserClient.on(IPC_CHANNELS.OVERLAY_ACTION, (...args: unknown[]) => {
      const [actionId, actionType, actionData] = args as [string, string, unknown]
      if (actionId === id) {
        onAction(actionType, actionData)
      }
    })
    return unsub
  }, [id, onAction])

  useEffect(() => {
    return () => {
      if (activeRef.current) {
        browserClient.hideOverlay(id)
      }
    }
  }, [id])

  const show = useCallback(
    (bounds: OverlayBounds, content: { type: string; [key: string]: unknown }, options?: { autoDismiss?: boolean }) => {
      browserClient.showOverlay(id, bounds, content, options)
      activeRef.current = true
    },
    [id]
  )

  const hide = useCallback(() => {
    browserClient.hideOverlay(id)
    activeRef.current = false
  }, [id])

  return { show, hide }
}
