import { useEffect } from 'react'
import { retainWalletActivity } from './activity'

export function useWalletPageOpen(open: boolean): void {
  useEffect(() => {
    if (open) return retainWalletActivity()
  }, [open])
}
