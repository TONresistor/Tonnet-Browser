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
import { createLogger } from '@/logger'
import {
  REQUIRED_NAMESPACES,
  OPTIONAL_NAMESPACES,
  NAMESPACE_LABELS,
  NAMESPACE_DESCRIPTIONS,
  isRequiredNamespace,
} from '@shared/bridge-config'
import type { BridgeConfig, NamespaceKey } from '@shared/bridge-config'
import type { BridgePermission } from '@shared/types'

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

// --- Permission labels ---

const SCOPE_LABELS: Record<string, string> = {
  blockchain: 'Blockchain',
  p2p: 'P2P Network',
  write: 'Write/Broadcast',
}

const DECISION_LABELS: Record<string, string> = {
  granted: 'Always',
  denied: 'Denied',
  session: 'Session',
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

  // Notify parent of dirty state
  useEffect(() => {
    onDirtyChange?.(hasChanges)
  }, [hasChanges, onDirtyChange])

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

  // Expose to parent via ref
  useEffect(() => {
    if (sectionRef) {
      ;(sectionRef as React.MutableRefObject<BridgeSectionHandle | null>).current = {
        save: saveToMain,
        discard: discardChanges,
        hasChanges,
      }
    }
  }, [sectionRef, saveToMain, discardChanges, hasChanges])

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

  if (isLoading) {
    return (
      <div>
        <SectionHeader title="Bridge" description="TON network bridge configuration and permissions." />
        <div className="glass-card p-8 flex items-center justify-center">
          <span className="text-muted-foreground text-sm">Loading...</span>
        </div>
      </div>
    )
  }

  return (
    <div>
      <SectionHeader title="Bridge" description="TON network bridge configuration and permissions." />

      {/* Restart required banner */}
      {restartRequired && (
        <div className="mb-6 glass-card px-4 py-3 border border-yellow-500/30 bg-yellow-500/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
              <span className="text-sm text-foreground">Bridge configuration changed. Restart to apply.</span>
            </div>
            <button
              onClick={handleRestart}
              disabled={restarting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 transition-colors disabled:opacity-50"
            >
              <RotateCw className={cn('h-3.5 w-3.5', restarting && 'animate-spin')} />
              {restarting ? 'Restarting...' : 'Restart Now'}
            </button>
          </div>
        </div>
      )}

      {/* Default Policy */}
      <div className="glass-card px-4">
        <SettingRow label="Default Policy" description="How the bridge handles requests from unknown sites.">
          <ToggleGroup
            value={draftPolicy}
            onChange={(v) => setDraftPolicy(v as 'ask' | 'deny')}
            options={[
              { value: 'ask', label: 'Ask' },
              { value: 'deny', label: 'Deny' },
            ]}
          />
        </SettingRow>
      </div>

      {/* Namespaces */}
      {draftConfig && (
        <div className="mt-6 glass-card px-4">
          <div className="py-4 border-b border-border">
            <p className="text-foreground font-medium">Namespaces</p>
            <p className="text-muted-foreground text-sm mt-0.5">
              Enable or disable bridge API namespaces. Required namespaces cannot be turned off.
            </p>
          </div>

          {/* Required namespaces */}
          <div className="py-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wider py-2">Required</p>
            {REQUIRED_NAMESPACES.map((ns) => (
              <SettingRow key={ns} label={NAMESPACE_LABELS[ns]} description={NAMESPACE_DESCRIPTIONS[ns]}>
                <Toggle checked={true} onChange={() => {}} label={NAMESPACE_LABELS[ns]} disabled />
              </SettingRow>
            ))}
          </div>

          <div className="border-t border-border" />

          {/* Optional namespaces */}
          <div className="py-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wider py-2">Optional</p>
            {OPTIONAL_NAMESPACES.map((ns) => (
              <SettingRow key={ns} label={NAMESPACE_LABELS[ns]} description={NAMESPACE_DESCRIPTIONS[ns]}>
                <Toggle
                  checked={getNamespaceEnabled(draftConfig, ns)}
                  onChange={(v) => setNamespaceEnabled(ns, v)}
                  label={NAMESPACE_LABELS[ns]}
                />
              </SettingRow>
            ))}
          </div>
        </div>
      )}

      {/* Security */}
      {draftConfig && (
        <div className="mt-6 glass-card px-4">
          <div className="py-4 border-b border-border">
            <p className="text-foreground font-medium">Security</p>
          </div>
          <SettingRow
            label="SSRF Protection"
            description="Block ADNL connections to private and loopback IP addresses."
          >
            <Toggle
              checked={draftConfig.namespaces?.adnl?.ssrf_protection !== false}
              onChange={(v) => setSecurityField('adnl', 'ssrf_protection', v)}
              label="SSRF Protection"
            />
          </SettingRow>
          <SettingRow
            label="DHT Write Access"
            description="Allow dApps to store data in the DHT. Disabled by default for security."
          >
            <Toggle
              checked={draftConfig.namespaces?.dht?.allow_write === true}
              onChange={(v) => setSecurityField('dht', 'allow_write', v)}
              label="DHT Write Access"
            />
          </SettingRow>
        </div>
      )}

      {/* Advanced (collapsible) */}
      {draftConfig && (
        <div className="mt-6 glass-card">
          <button
            type="button"
            onClick={() => setAdvancedOpen(!advancedOpen)}
            className="flex items-center justify-between w-full px-4 py-4 text-left"
          >
            <p className="text-foreground font-medium">Advanced</p>
            <ChevronDown
              className={cn(
                'h-4 w-4 text-muted-foreground transition-transform duration-200',
                advancedOpen && 'rotate-180'
              )}
            />
          </button>
          {advancedOpen && (
            <div className="px-4 pb-2">
              <SettingRow label="Max Clients" description="Maximum concurrent WebSocket connections.">
                <NumberInput
                  value={draftConfig.max_clients ?? 100}
                  onChange={(v) => setTopLevel('max_clients', v)}
                  min={1}
                  max={1000}
                />
              </SettingRow>
              <SettingRow label="Max Inflight" description="Maximum concurrent requests per client.">
                <NumberInput
                  value={draftConfig.websocket?.max_inflight ?? 100}
                  onChange={(v) => setWebSocket('max_inflight', v)}
                  min={1}
                  max={1000}
                />
              </SettingRow>
              <SettingRow label="Max Message Size" description="Maximum JSON-RPC message size.">
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
          <p className="text-foreground font-medium">Site Permissions</p>
          <p className="text-muted-foreground text-sm mt-0.5">
            Per-domain bridge access permissions granted to TON sites.
          </p>
        </div>
        {Object.keys(grouped).length === 0 ? (
          <p className="text-muted-foreground text-sm">No site permissions yet.</p>
        ) : (
          <div className="space-y-4">
            {Object.entries(grouped).map(([domain, perms]) => (
              <div key={domain} className="glass-card p-4">
                <h4 className="text-foreground font-medium mb-3">{domain}</h4>
                <div className="space-y-2">
                  {perms.map((p) => (
                    <div key={`${p.domain}:${p.scope}`} className="flex items-center justify-between py-1.5">
                      <span className="text-sm text-foreground">{SCOPE_LABELS[p.scope] || p.scope}</span>
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
                          {DECISION_LABELS[p.decision] || p.decision}
                        </span>
                        <button
                          className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                          onClick={() => handleRevoke(p.domain, p.scope)}
                        >
                          Revoke
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
