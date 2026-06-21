/**
 * Bridge settings section.
 * Manages bridge config (namespaces, security, advanced) and permissions.
 */

import { memo, useState, useEffect, useCallback } from 'react'
import { ChevronDown, AlertTriangle, RotateCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { Toggle } from '../shared/Toggle'
import { ToggleGroup } from '../shared/ToggleGroup'
import { NumberInput } from '../shared/NumberInput'
import { GroupHeader } from '../shared/GroupHeader'
import { createLogger } from '@/logger'
import { useTranslation } from 'react-i18next'
import { REQUIRED_NAMESPACES, OPTIONAL_NAMESPACES, isRequiredNamespace } from '@shared/bridge-config'
import type { BridgeConfig, NamespaceKey } from '@shared/bridge-config'
import type { BridgePermission } from '@shared/types'
import { useSectionHandle } from '@/hooks/useSectionHandle'

const log = createLogger('bridge-settings')

// --- Types ---

export interface BridgeSectionHandle {
  save: () => Promise<void>
  discard: () => void
  hasChanges: boolean
}

interface BridgeSectionProps {
  onDirtyChange?: (dirty: boolean) => void
  sectionRef?: React.RefObject<BridgeSectionHandle | null>
}

// --- Helpers ---

function getNamespaceEnabled(config: BridgeConfig | null, ns: NamespaceKey): boolean {
  if (!config?.namespaces) return true
  const nsConfig = config.namespaces[ns] as { enabled?: boolean } | undefined
  if (!nsConfig) return true
  return nsConfig.enabled !== false
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

// --- Component ---

export const BridgeSection = memo(function BridgeSection({ onDirtyChange, sectionRef }: BridgeSectionProps) {
  const { t } = useTranslation('settings')

  // Bridge config state
  const [savedConfig, setSavedConfig] = useState<BridgeConfig | null>(null)
  const [draftConfig, setDraftConfig] = useState<BridgeConfig | null>(null)

  // Default policy state
  const [savedPolicy, setSavedPolicy] = useState<'ask' | 'deny'>('ask')
  const [draftPolicy, setDraftPolicy] = useState<'ask' | 'deny'>('ask')

  // UI state
  const [permissions, setPermissions] = useState<BridgePermission[]>([])
  const [restartRequired, setRestartRequired] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const configChanged = JSON.stringify(savedConfig) !== JSON.stringify(draftConfig)
  const policyChanged = savedPolicy !== draftPolicy
  const hasChanges = configChanged || policyChanged

  // Load on mount
  useEffect(() => {
    const load = async () => {
      try {
        const [config, bridgeSettings, perms] = await Promise.all([
          window.electron.bridge.getConfig(),
          window.electron.settings.get('bridge'),
          window.electron.bridge.getPermissions(),
        ])

        if (config) {
          setSavedConfig(config)
          setDraftConfig(deepClone(config))
        }

        const policy = (bridgeSettings as { defaultPolicy?: string })?.defaultPolicy
        if (policy === 'ask' || policy === 'deny') {
          setSavedPolicy(policy)
          setDraftPolicy(policy)
        }

        if (Array.isArray(perms)) setPermissions(perms)
      } catch (err) {
        log.error('Failed to load bridge settings:', err)
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [])

  // Save
  const saveToMain = useCallback(async () => {
    try {
      if (policyChanged) {
        await window.electron.settings.set('bridge', { defaultPolicy: draftPolicy })
        setSavedPolicy(draftPolicy)
      }
      if (configChanged && draftConfig) {
        await window.electron.bridge.setConfig(draftConfig)
        setSavedConfig(deepClone(draftConfig))
        setRestartRequired(true)
      }
    } catch (err) {
      log.error('Failed to save bridge settings:', err)
    }
  }, [draftConfig, draftPolicy, configChanged, policyChanged])

  // Discard
  const discardChanges = useCallback(() => {
    setDraftConfig(savedConfig ? deepClone(savedConfig) : null)
    setDraftPolicy(savedPolicy)
  }, [savedConfig, savedPolicy])

  // Notify parent of dirty state + expose save/discard handle via ref
  useSectionHandle(sectionRef, { save: saveToMain, discard: discardChanges, hasChanges }, onDirtyChange)

  // Config updaters
  const setNamespaceEnabled = (ns: NamespaceKey, enabled: boolean) => {
    if (isRequiredNamespace(ns)) return
    setDraftConfig((prev) => {
      if (!prev) return prev
      const next = deepClone(prev)
      if (!next.namespaces[ns]) {
        ;(next.namespaces as unknown as Record<string, Record<string, unknown>>)[ns] = {}
      }
      ;(next.namespaces[ns] as { enabled?: boolean }).enabled = enabled
      return next
    })
  }

  const setSecurityField = (ns: 'adnl' | 'dht', field: string, value: boolean) => {
    setDraftConfig((prev) => {
      if (!prev) return prev
      const next = deepClone(prev)
      if (!next.namespaces[ns]) {
        ;(next.namespaces as unknown as Record<string, Record<string, unknown>>)[ns] = {}
      }
      ;(next.namespaces[ns] as Record<string, unknown>)[field] = value
      return next
    })
  }

  const setTopLevel = (field: keyof BridgeConfig, value: number) => {
    setDraftConfig((prev) => {
      if (!prev) return prev
      const next = deepClone(prev)
      ;(next as Record<string, unknown>)[field] = value
      return next
    })
  }

  const setWebSocket = (field: string, value: number) => {
    setDraftConfig((prev) => {
      if (!prev) return prev
      const next = deepClone(prev)
      if (!next.websocket) next.websocket = {}
      ;(next.websocket as Record<string, unknown>)[field] = value
      return next
    })
  }

  // Restart handler
  const handleRestart = async () => {
    setRestarting(true)
    try {
      const result = await window.electron.bridge.restart()
      if (result.success) {
        setRestartRequired(false)
      }
    } catch (err) {
      log.error('Bridge restart failed:', err)
    } finally {
      setRestarting(false)
    }
  }

  // Permission handlers
  const loadPermissions = async () => {
    const result = await window.electron.bridge.getPermissions()
    if (Array.isArray(result)) setPermissions(result)
  }

  const handleRevoke = async (domain: string, scope: string) => {
    await window.electron.bridge.revokePermission(domain, scope)
    await loadPermissions()
  }

  const grouped = permissions.reduce(
    (acc, p) => {
      if (!acc[p.domain]) acc[p.domain] = []
      acc[p.domain].push(p)
      return acc
    },
    {} as Record<string, BridgePermission[]>
  )

  const getNamespaceLabel = (ns: NamespaceKey): string => t(`bridge.namespaces.labels.${ns}`)
  const getNamespaceDescription = (ns: NamespaceKey): string => t(`bridge.namespaces.descriptions.${ns}`)
  const getScopeLabel = (scope: string): string => t(`bridge.scopes.${scope}`, { defaultValue: scope })
  const getDecisionLabel = (decision: string): string => t(`bridge.decisions.${decision}`, { defaultValue: decision })

  if (isLoading) {
    return (
      <div>
        <SectionHeader title={t('bridge.title')} description={t('bridge.description')} />
        <div className="settings-group p-8 flex items-center justify-center">
          <span className="text-muted-foreground text-sm">{t('bridge.loading')}</span>
        </div>
      </div>
    )
  }

  return (
    <div>
      <SectionHeader title={t('bridge.title')} description={t('bridge.description')} />

      {/* Restart required banner */}
      {restartRequired && (
        <div className="mb-6 settings-group px-4 py-3 border border-yellow-500/30 bg-yellow-500/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
              <span className="text-sm text-foreground">{t('bridge.restartRequired')}</span>
            </div>
            <button
              onClick={handleRestart}
              disabled={restarting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 transition-colors disabled:opacity-50"
            >
              <RotateCw className={cn('h-3.5 w-3.5', restarting && 'animate-spin')} />
              {restarting ? t('bridge.restarting') : t('bridge.restartNow')}
            </button>
          </div>
        </div>
      )}

      {/* Default Policy */}
      <div className="settings-group px-4">
        <SettingRow label={t('bridge.defaultPolicy')} description={t('bridge.defaultPolicyDesc')}>
          <ToggleGroup
            value={draftPolicy}
            onChange={(v) => setDraftPolicy(v as 'ask' | 'deny')}
            options={[
              { value: 'ask', label: t('bridge.policyAsk') },
              { value: 'deny', label: t('bridge.policyDeny') },
            ]}
          />
        </SettingRow>
      </div>

      {/* Namespaces */}
      {draftConfig && (
        <div className="mt-6 settings-group px-4">
          <GroupHeader title={t('bridge.namespaces.title')} description={t('bridge.namespaces.description')} />

          {/* Required namespaces */}
          <div className="py-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wider py-2">
              {t('bridge.namespaces.required')}
            </p>
            {REQUIRED_NAMESPACES.map((ns) => (
              <SettingRow key={ns} label={getNamespaceLabel(ns)} description={getNamespaceDescription(ns)}>
                <Toggle checked={true} onChange={() => {}} ariaLabel={getNamespaceLabel(ns)} disabled />
              </SettingRow>
            ))}
          </div>

          <div className="border-t border-border" />

          {/* Optional namespaces */}
          <div className="py-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wider py-2">
              {t('bridge.namespaces.optional')}
            </p>
            {OPTIONAL_NAMESPACES.map((ns) => (
              <SettingRow key={ns} label={getNamespaceLabel(ns)} description={getNamespaceDescription(ns)}>
                <Toggle
                  checked={getNamespaceEnabled(draftConfig, ns)}
                  onChange={(v) => setNamespaceEnabled(ns, v)}
                  ariaLabel={getNamespaceLabel(ns)}
                />
              </SettingRow>
            ))}
          </div>
        </div>
      )}

      {/* Security */}
      {draftConfig && (
        <div className="mt-6 settings-group px-4">
          <GroupHeader title={t('bridge.security.title')} />
          <SettingRow label={t('bridge.security.ssrfProtection')} description={t('bridge.security.ssrfProtectionDesc')}>
            <Toggle
              checked={draftConfig.namespaces?.adnl?.ssrf_protection !== false}
              onChange={(v) => setSecurityField('adnl', 'ssrf_protection', v)}
              ariaLabel={t('bridge.security.ssrfProtection')}
            />
          </SettingRow>
          <SettingRow label={t('bridge.security.dhtWriteAccess')} description={t('bridge.security.dhtWriteAccessDesc')}>
            <Toggle
              checked={draftConfig.namespaces?.dht?.allow_write === true}
              onChange={(v) => setSecurityField('dht', 'allow_write', v)}
              ariaLabel={t('bridge.security.dhtWriteAccess')}
            />
          </SettingRow>
        </div>
      )}

      {/* Advanced (collapsible) */}
      {draftConfig && (
        <div className="mt-6 settings-group">
          <button
            type="button"
            onClick={() => setAdvancedOpen(!advancedOpen)}
            className="flex items-center justify-between w-full px-4 py-4 text-left"
          >
            <p className="text-foreground font-medium">{t('bridge.advanced.title')}</p>
            <ChevronDown
              className={cn(
                'h-4 w-4 text-muted-foreground transition-transform duration-200',
                advancedOpen && 'rotate-180'
              )}
            />
          </button>
          {advancedOpen && (
            <div className="px-4 pb-2">
              <SettingRow label={t('bridge.advanced.maxClients')} description={t('bridge.advanced.maxClientsDesc')}>
                <NumberInput
                  value={draftConfig.max_clients ?? 100}
                  onChange={(v) => setTopLevel('max_clients', v)}
                  min={1}
                  max={1000}
                />
              </SettingRow>
              <SettingRow label={t('bridge.advanced.maxInflight')} description={t('bridge.advanced.maxInflightDesc')}>
                <NumberInput
                  value={draftConfig.websocket?.max_inflight ?? 100}
                  onChange={(v) => setWebSocket('max_inflight', v)}
                  min={1}
                  max={1000}
                />
              </SettingRow>
              <SettingRow
                label={t('bridge.advanced.maxMessageSize')}
                description={t('bridge.advanced.maxMessageSizeDesc')}
              >
                <NumberInput
                  value={Math.round((draftConfig.websocket?.max_message_size ?? 1048576) / 1024)}
                  onChange={(v) => setWebSocket('max_message_size', v * 1024)}
                  min={64}
                  max={10240}
                  suffix="KB"
                />
              </SettingRow>
            </div>
          )}
        </div>
      )}

      {/* Permissions */}
      <div className="mt-6">
        <div className="py-4">
          <p className="text-foreground font-medium">{t('bridge.sitePermissions.title')}</p>
          <p className="text-muted-foreground text-sm mt-0.5">{t('bridge.sitePermissions.description')}</p>
        </div>
        {Object.keys(grouped).length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('bridge.sitePermissions.empty')}</p>
        ) : (
          <div className="space-y-4">
            {Object.entries(grouped).map(([domain, perms]) => (
              <div key={domain} className="settings-group p-4">
                <h4 className="text-foreground font-medium mb-3">{domain}</h4>
                <div className="space-y-2">
                  {perms.map((p) => (
                    <div key={`${p.domain}:${p.scope}`} className="flex items-center justify-between py-1.5">
                      <span className="text-sm text-foreground">{getScopeLabel(p.scope)}</span>
                      <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            'text-xs px-2 py-0.5 rounded-full',
                            p.decision === 'granted'
                              ? 'bg-green-500/20 text-green-400'
                              : p.decision === 'denied'
                                ? 'bg-red-500/20 text-red-400'
                                : 'bg-yellow-500/20 text-yellow-400'
                          )}
                        >
                          {getDecisionLabel(p.decision)}
                        </span>
                        <button
                          className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                          onClick={() => handleRevoke(p.domain, p.scope)}
                        >
                          {t('bridge.revoke')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
})
