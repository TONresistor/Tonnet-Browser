/**
 * Wallet settings section.
 * Uses a local draft that integrates with the global Save/Discard flow
 * via onDirtyChange/onSave/onDiscard callbacks.
 */

import { memo, useState, useEffect, useCallback } from 'react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { Toggle } from '../shared/Toggle'
import { TextInput } from '../shared/TextInput'
import { createLogger } from '@/logger'
import { walletClient } from '@/features/wallet/client'
import { useTranslation } from 'react-i18next'
import type { WalletSettings } from '@shared/types'
import { LoaderCircle } from 'lucide-react'
import { WalletManagementPanel } from './WalletManagementPanel'
import { ConnectedAppsPanel } from './ConnectedAppsPanel'
import { useSectionHandle } from '@/hooks/useSectionHandle'
import { settingsClient } from '@/features/settings/client'
import { usePreferencesStore } from '@/features/settings/preferences-store'

const log = createLogger('wallet-settings')

const DEFAULT_WALLET_SETTINGS: WalletSettings = {
  paymentMode: 'off',
  notificationStyle: 'popup',
  limits: { perRequest: '0', perDay: '0', perSitePerMonth: '0' },
  sitePolicies: [],
  autoPayDomains: [],
  autoLockMinutes: 5,
  indexerEnabled: false,
  indexerEndpoint: 'https://toncenter.com/api/v3',
  indexerApiKey: '',
}

export interface WalletSectionHandle {
  save: () => Promise<void>
  discard: () => void
  hasChanges: boolean
}

interface WalletSectionProps {
  onDirtyChange?: (dirty: boolean) => void
  sectionRef?: React.RefObject<WalletSectionHandle | null>
}

export const WalletSection = memo(function WalletSection({ onDirtyChange, sectionRef }: WalletSectionProps) {
  const { t } = useTranslation('settings')
  const tonConnectEnabled = usePreferencesStore((state) => state.saved.tonConnectEnabled)
  const [saved, setSaved] = useState<WalletSettings>(DEFAULT_WALLET_SETTINGS)
  const [draft, setDraft] = useState<WalletSettings>(DEFAULT_WALLET_SETTINGS)
  const [isLoading, setIsLoading] = useState(true)

  const hasChanges = JSON.stringify(saved) !== JSON.stringify(draft)

  // Load settings on mount
  useEffect(() => {
    let active = true
    let canonicalRevision = 0
    let initialized = false
    const off = settingsClient.onChanged((change) => {
      if (!change.settings || (!change.reset && change.category !== 'wallet')) return
      canonicalRevision += 1
      const next = change.settings.wallet
      const values = change.values as Partial<WalletSettings> | undefined
      const replaceIndexerDraft =
        change.reset ||
        !initialized ||
        !values ||
        ['indexerEnabled', 'indexerEndpoint', 'indexerApiKey'].some((key) =>
          Object.prototype.hasOwnProperty.call(values, key)
        )
      setSaved(next)
      setDraft((current) =>
        replaceIndexerDraft
          ? next
          : {
              ...next,
              indexerEnabled: current.indexerEnabled,
              indexerEndpoint: current.indexerEndpoint,
              indexerApiKey: current.indexerApiKey,
            }
      )
      setIsLoading(false)
      initialized = true
    })
    const loadRevision = canonicalRevision
    const load = async () => {
      try {
        const walletSettings = await walletClient.getSettings()
        if (!active || !walletSettings || canonicalRevision !== loadRevision) return
        const next = walletSettings as WalletSettings
        setSaved(next)
        setDraft(next)
        initialized = true
      } catch (err) {
        if (active) log.error('Failed to load wallet settings:', err)
      } finally {
        if (active) setIsLoading(false)
      }
    }
    void load()
    return () => {
      active = false
      off()
    }
  }, [])

  const saveToMain = useCallback(async () => {
    try {
      await walletClient.updateSettings({
        autoLockMinutes: draft.autoLockMinutes,
        indexerEnabled: draft.indexerEnabled,
        indexerEndpoint: draft.indexerEndpoint,
        indexerApiKey: draft.indexerApiKey,
      })
      setSaved(draft)
    } catch (err) {
      log.error('Failed to save wallet settings:', err)
      throw err
    }
  }, [draft])

  const discardChanges = useCallback(() => {
    setDraft(saved)
  }, [saved])

  // Notify parent of dirty state + expose save/discard handle via ref
  useSectionHandle(sectionRef, { save: saveToMain, discard: discardChanges, hasChanges }, onDirtyChange)

  const updateDraft = (updates: Partial<WalletSettings>) => {
    setDraft((prev) => ({ ...prev, ...updates }))
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoaderCircle className="h-6 w-6 text-muted-foreground animate-spin" aria-hidden="true" />
      </div>
    )
  }

  return (
    <div>
      <SectionHeader title={t('wallet.title')} description={t('wallet.description')} />

      {/* Wallet management: export / import */}
      <WalletManagementPanel />

      {tonConnectEnabled && <ConnectedAppsPanel />}

      <div className="mt-6">
        <h3 className="mb-2 px-1 text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
          Wallet security
        </h3>
        <div className="settings-group px-4">
          <SettingRow
            label="Auto-lock"
            description="Clear the decrypted signing key after this many minutes. Use 0 only if you understand the risk."
          >
            <TextInput
              value={String(draft.autoLockMinutes)}
              onChange={(value) => {
                const minutes = Number.parseInt(value, 10)
                if (Number.isInteger(minutes) && minutes >= 0 && minutes <= 1440) {
                  updateDraft({ autoLockMinutes: minutes })
                }
              }}
              placeholder="5"
              ariaLabel="Wallet auto-lock minutes"
            />
          </SettingRow>
        </div>
      </div>

      <div className="mt-6">
        <h3 className="mb-2 px-1 text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
          {t('wallet.historyGroup', { defaultValue: 'Transaction history' })}
        </h3>
        <div className="settings-group px-4">
          <SettingRow
            label={t('wallet.indexerEnabled', { defaultValue: 'Full history via indexer' })}
            description={t('wallet.indexerEnabledDesc', {
              defaultValue: 'Recover full history via an HTTP indexer (clearnet, exposes your address).',
            })}
          >
            <Toggle
              checked={draft.indexerEnabled}
              onChange={(v) => updateDraft({ indexerEnabled: v })}
              ariaLabel={t('wallet.indexerEnabled', { defaultValue: 'Full history via indexer' })}
            />
          </SettingRow>
          {draft.indexerEnabled && (
            <>
              <SettingRow
                label={t('wallet.indexerEndpoint', { defaultValue: 'Indexer endpoint' })}
                description={t('wallet.indexerEndpointDesc', {
                  defaultValue: 'Toncenter-compatible v3 API base URL (Orbs or a self-hosted instance also work).',
                })}
              >
                <TextInput
                  value={draft.indexerEndpoint}
                  onChange={(v) => updateDraft({ indexerEndpoint: v })}
                  placeholder="https://toncenter.com/api/v3"
                  ariaLabel={t('wallet.indexerEndpoint', { defaultValue: 'Indexer endpoint' })}
                />
              </SettingRow>
              <SettingRow
                label={t('wallet.indexerApiKey', { defaultValue: 'API key (optional)' })}
                description={t('wallet.indexerApiKeyDesc', { defaultValue: 'Relaxes rate limits on shared indexers.' })}
              >
                <TextInput
                  value={draft.indexerApiKey}
                  onChange={(v) => updateDraft({ indexerApiKey: v })}
                  placeholder="Optional"
                  ariaLabel={t('wallet.indexerApiKey', { defaultValue: 'API key' })}
                />
              </SettingRow>
            </>
          )}
        </div>
      </div>
    </div>
  )
})
