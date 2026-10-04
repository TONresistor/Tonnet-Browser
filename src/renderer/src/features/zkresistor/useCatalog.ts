import { useCallback, useEffect, useState } from 'react'
import type { ZkResistorCatalog } from '@shared/types'
import { zkResistorClient } from './client'

let catalogConsumers = 0

let cachedCatalog: ZkResistorCatalog | null = null
let pendingCatalog: Promise<ZkResistorCatalog> | null = null

async function loadCatalog(): Promise<ZkResistorCatalog> {
  if (pendingCatalog) return pendingCatalog

  const request = requestCatalog()
  pendingCatalog = request
  try {
    cachedCatalog = await request
    return cachedCatalog
  } finally {
    if (pendingCatalog === request) pendingCatalog = null
  }
}

async function requestCatalog(): Promise<ZkResistorCatalog> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await zkResistorClient.catalog()
    } catch (error) {
      const retryable =
        error instanceof Error &&
        'code' in error &&
        error.code === 'ZKRESISTOR_CATALOG_FAILED' &&
        'retryable' in error &&
        error.retryable === true
      if (!retryable || attempt >= 2 || catalogConsumers === 0) throw error
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
      if (catalogConsumers === 0) throw error
    }
  }
}

export function useZkResistorCatalog() {
  const [catalog, setCatalog] = useState<ZkResistorCatalog | null>(cachedCatalog)
  const [loading, setLoading] = useState(!cachedCatalog)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setCatalog(await loadCatalog())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load ZKResistor')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    catalogConsumers += 1
    void load()
    return () => {
      catalogConsumers -= 1
    }
  }, [load])

  return { catalog, loading, error, reload: load }
}
