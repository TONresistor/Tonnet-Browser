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
import { useTranslation } from 'react-i18next'
import type { WalletSettings } from '@shared/types'
import { LoaderCircle } from 'lucide-react'
import { WalletManagementPanel } from './WalletManagementPanel'
import { ConnectedAppsPanel } from './ConnectedAppsPanel'
import { useSectionHandle } from '@/hooks/useSectionHandle'

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
  const [saved, setSaved] = useState<WalletSettings>(DEFAULT_WALLET_SETTINGS)
  const [draft, setDraft] = useState<WalletSettings>(DEFAULT_WALLET_SETTINGS)
  const [isLoading, setIsLoading] = useState(true)

  const hasChanges = JSON.stringify(saved) !== JSON.stringify(draft)

  // Load settings on mount
  useEffect(() => {
    const load = async () => {
      try {
        const walletSettings = await window.electron.settings.get('wallet')
        if (walletSettings) {
          const s = walletSettings as WalletSettings
          setSaved(s)
          setDraft(s)
        }
      } catch (err) {
        log.error('Failed to load wallet settings:', err)
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [])

  const saveToMain = useCallback(async () => {
    try {
      await window.electron.settings.set('wallet', {
        indexerEnabled: draft.indexerEnabled,
        indexerEndpoint: draft.indexerEndpoint,
        indexerApiKey: draft.indexerApiKey,
      })
      setSaved(draft)
    } catch (err) {
      log.error('Failed to save wallet settings:', err)
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

      <ConnectedAppsPanel />

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
