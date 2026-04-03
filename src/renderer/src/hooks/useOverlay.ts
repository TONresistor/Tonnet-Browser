/**
 * Hook for overlay management.
 * Show/hide native overlays and receive user actions.
 */

import { useEffect, useCallback, useRef } from 'react'

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
    const unsub = window.electron.on('overlay:action', (...args: unknown[]) => {
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
        window.electron.overlay.hide(id)
      }
    }
  }, [id])

  const show = useCallback(
    (bounds: OverlayBounds, content: { type: string; [key: string]: unknown }, options?: { autoDismiss?: boolean }) => {
      window.electron.overlay.show(id, bounds, content, options)
      activeRef.current = true
    },
    [id]
  )

  const hide = useCallback(() => {
    window.electron.overlay.hide(id)
    activeRef.current = false
  }, [id])

  return { show, hide }
}
