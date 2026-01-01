/**
 * Hook for TON Storage operations.
 * Add, remove, and manage storage bags.
 */

import { useState, useCallback, useEffect } from 'react'
import type { StorageBag } from '@shared/types'

export function useStorage() {
  const [bags, setBags] = useState<StorageBag[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    try {
      const result = await window.electron.storage.listBags()
      if (result.success) {
        setBags(result.bags as StorageBag[])
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const addBag = useCallback(async (bagId: string, name?: string) => {
    setError(null)
    try {
      const result = await window.electron.storage.addBag(bagId, name)
      if (result.success) {
        await refresh()
        return true
      } else {
        setError(result.error ?? 'Failed to add bag')
        return false
      }
    } catch (err) {
      setError((err as Error).message)
      return false
    }
  }, [refresh])

  const removeBag = useCallback(async (bagId: string) => {
    try {
      const result = await window.electron.storage.removeBag(bagId)
      if (result.success) {
        await refresh()
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }, [refresh])

  const pauseBag = useCallback(async (bagId: string) => {
    try {
      await window.electron.storage.pauseBag(bagId)
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    }
  }, [refresh])

  const resumeBag = useCallback(async (bagId: string) => {
    try {
      await window.electron.storage.resumeBag(bagId)
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    }
  }, [refresh])

  // Initial load
  useEffect(() => {
    refresh()
  }, [refresh])

  return {
    bags,
    isLoading,
    error,
    addBag,
    removeBag,
    pauseBag,
    resumeBag,
    refresh,
  }
}
