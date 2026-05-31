/**
 * Two-step "press twice to confirm" helper.
 *
 * The first `trigger()` arms a pending state and returns false; a second
 * `trigger()` for the same id within `timeoutMs` confirms and returns true.
 * The pending state auto-resets after the timeout. The hook owns its timer and
 * clears it on unmount. Use one instance per independent confirmable action so
 * arming one does not cancel another.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { UI_NOTIFICATION_TIMEOUT_MS } from '@shared/constants'

const DEFAULT_ID = '__default__'

export function useConfirmAction(timeoutMs: number = UI_NOTIFICATION_TIMEOUT_MS) {
  const [armedId, setArmedId] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    setArmedId(null)
  }, [])

  // Clear any pending timer on unmount.
  useEffect(() => reset, [reset])

  /** Returns true when this call confirms (the same id was already armed). */
  const trigger = useCallback(
    (id: string = DEFAULT_ID): boolean => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (armedId === id) {
        timerRef.current = null
        setArmedId(null)
        return true
      }
      setArmedId(id)
      timerRef.current = setTimeout(() => setArmedId(null), timeoutMs)
      return false
    },
    [armedId, timeoutMs]
  )

  /** True when the given id (or the default) is currently armed. */
  const isArmed = useCallback((id: string = DEFAULT_ID): boolean => armedId === id, [armedId])

  return { armedId, isArmed, trigger, reset }
}
