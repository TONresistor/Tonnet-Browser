import { useCallback, useEffect, useState } from 'react'
import type { ZkResistorCatalog } from '@shared/types'
import { zkResistorClient } from './client'

let cachedCatalog: ZkResistorCatalog | null = null
let pendingCatalog: Promise<ZkResistorCatalog> | null = null

async function loadCatalog(): Promise<ZkResistorCatalog> {
  if (pendingCatalog) return pendingCatalog

  const request = zkResistorClient.catalog()
  pendingCatalog = request
  try {
    cachedCatalog = await request
    return cachedCatalog
  } finally {
    if (pendingCatalog === request) pendingCatalog = null
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
    void load()
  }, [load])

  return { catalog, loading, error, reload: load }
}
