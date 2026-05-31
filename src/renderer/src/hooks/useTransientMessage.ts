import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A transient string message (e.g. a success banner) that auto-clears after
 * `timeoutMs`. The timer is cleared on unmount and whenever a new message is
 * shown, so it can never fire setState after unmount or leak across messages.
 *
 * Returns [message, show, clear].
 */
export function useTransientMessage(timeoutMs = 6_000): [string | null, (message: string) => void, () => void] {
  const [message, setMessage] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = (): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const clear = useCallback((): void => {
    clearTimer()
    setMessage(null)
  }, [])

  const show = useCallback(
    (next: string): void => {
      clearTimer()
      setMessage(next)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        setMessage(null)
      }, timeoutMs)
    },
    [timeoutMs]
  )

  useEffect(() => clearTimer, [])

  return [message, show, clear]
}
