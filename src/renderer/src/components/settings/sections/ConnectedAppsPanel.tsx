import { memo, useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { createLogger } from '@/logger'
import type { TonConnectSession } from '@shared/types'

const log = createLogger('tonconnect-settings')

export const ConnectedAppsPanel = memo(function ConnectedAppsPanel() {
  const { t } = useTranslation('settings')
  const [sessions, setSessions] = useState<TonConnectSession[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const result = await window.electron.tonconnect.getSessions()
      setSessions(Array.isArray(result) ? result : [])
    } catch (err) {
      log.error('Failed to load TON Connect sessions:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleDisconnect = useCallback(async (domain: string) => {
    try {
      await window.electron.tonconnect.disconnectSession(domain)
      setSessions((prev) => prev.filter((s) => s.domain !== domain))
    } catch (err) {
      log.error('Failed to disconnect TON Connect session:', err)
    }
  }, [])

  if (loading) return null

  return (
    <div className="mt-6">
      <h3 className="mb-2 px-1 text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
        {t('wallet.connectedApps', { defaultValue: 'Connected apps' })}
      </h3>
      {sessions.length === 0 ? (
        <div className="settings-group px-4 py-3">
          <p className="text-[13px] text-muted-foreground">
            {t('wallet.connectedAppsEmpty', { defaultValue: 'No apps are connected to your wallet.' })}
          </p>
        </div>
      ) : (
        <div className="settings-group">
          {sessions.map((s, i) => (
            <div
              key={s.domain}
              className={cn('flex items-center gap-3 px-4 py-3', i > 0 && 'border-t border-border-subtle')}
            >
              {s.appIconUrl ? (
                <img src={s.appIconUrl} alt="" className="h-9 w-9 shrink-0 rounded-card object-contain" />
              ) : (
                <div className="h-9 w-9 shrink-0 rounded-card bg-elevation-3" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium text-foreground">{s.appName}</p>
                <p className="truncate text-[13px] text-muted-foreground">{s.domain}</p>
              </div>
              <button
                type="button"
                onClick={() => handleDisconnect(s.domain)}
                className="shrink-0 text-[13px] text-muted-foreground transition-colors hover:text-destructive"
              >
                {t('wallet.disconnect', { defaultValue: 'Disconnect' })}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})
