import { useEffect } from 'react'
import { create } from 'zustand'
import type { ZkResistorResourceStatus } from '@shared/types'
import { usePreferencesStore } from '@/features/settings/preferences-store'
import { zkResistorClient } from './client'

export const useZkResistorResources = create<{
  state: ZkResistorResourceStatus
  retryCount: number
  retry: () => void
}>((set) => ({
  state: { status: 'idle', receivedBytes: 0, totalBytes: 0, error: null },
  retryCount: 0,
  retry: () => set((current) => ({ retryCount: current.retryCount + 1 })),
}))

export function usePrepareZkResistorResources(): void {
  const enabled = usePreferencesStore((s) => s.isLoaded && s.saved.zkResistorEnabled)
  const retryCount = useZkResistorResources((s) => s.retryCount)
  useEffect(() => {
    if (!enabled) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (prepare = false) => {
      try {
        const state = await (prepare ? zkResistorClient.prepareResources() : zkResistorClient.resourceStatus())
        if (!active) return
        useZkResistorResources.setState({ state })
        if (state.status !== 'error') timer = setTimeout(() => void poll(), state.status === 'ready' ? 5000 : 500)
      } catch {
        if (active)
          useZkResistorResources.setState({
            state: { status: 'error', receivedBytes: 0, totalBytes: 0, error: 'Unable to prepare ZKR resources' },
          })
      }
    }
    useZkResistorResources.setState({ state: { status: 'idle', receivedBytes: 0, totalBytes: 0, error: null } })
    void poll(true)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [enabled, retryCount])
}
