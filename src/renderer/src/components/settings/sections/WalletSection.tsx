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
import { Segmented } from '@/components/ui/ios/Segmented'
import { Collapsible } from '../shared/Collapsible'
import { GroupHeader } from '../shared/GroupHeader'
import { createLogger } from '@/logger'
import { useTranslation } from 'react-i18next'
import type { WalletSettings, PaymentMode, NotificationStyle, SitePolicy } from '@shared/types'
import { Trash2, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { tonToNano, formatTonAmount } from '@/stores/wallet'
import { WalletManagementPanel } from './WalletManagementPanel'
import { ConnectedAppsPanel } from './ConnectedAppsPanel'
import { TonStepperField } from '../shared/TonStepperField'
import { useSectionHandle } from '@/hooks/useSectionHandle'

const log = createLogger('wallet-settings')

const DEFAULT_WALLET_SETTINGS: WalletSettings = {
  paymentMode: 'manual',
  notificationStyle: 'popup',
  limits: { perRequest: '0', perDay: '0', perSitePerMonth: '0' },
  sitePolicies: [],
  autoPayDomains: [],
  autoLockMinutes: 5,
  indexerEnabled: false,
  indexerEndpoint: 'https://toncenter.com/api/v3',
  indexerApiKey: '',
}

function nanoToTonDisplay(nano: string): string {
  try {
    return formatTonAmount(nano)
  } catch {
    return '0'
  }
}

function tonDisplayToNano(val: string): string {
  if (!val || val === '0' || val === '') return '0'
  try {
    return tonToNano(val)
  } catch {
    return '0'
  }
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

  // Local display values for limit inputs (in TON)
  const [perRequestDisplay, setPerRequestDisplay] = useState('0')
  const [perDayDisplay, setPerDayDisplay] = useState('0')
  const [perSiteDisplay, setPerSiteDisplay] = useState('0')

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
          setPerRequestDisplay(nanoToTonDisplay(s.limits.perRequest))
          setPerDayDisplay(nanoToTonDisplay(s.limits.perDay))
          setPerSiteDisplay(nanoToTonDisplay(s.limits.perSitePerMonth))
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
      await window.electron.settings.set('wallet', draft)
      setSaved(draft)
    } catch (err) {
      log.error('Failed to save wallet settings:', err)
    }
  }, [draft])

  const discardChanges = useCallback(() => {
    setDraft(saved)
    setPerRequestDisplay(nanoToTonDisplay(saved.limits.perRequest))
    setPerDayDisplay(nanoToTonDisplay(saved.limits.perDay))
    setPerSiteDisplay(nanoToTonDisplay(saved.limits.perSitePerMonth))
  }, [saved])

  // Notify parent of dirty state + expose save/discard handle via ref
  useSectionHandle(sectionRef, { save: saveToMain, discard: discardChanges, hasChanges }, onDirtyChange)

  const updateDraft = (updates: Partial<WalletSettings>) => {
    setDraft((prev) => ({ ...prev, ...updates }))
  }

  const handleLimitBlur = (field: 'perRequest' | 'perDay' | 'perSitePerMonth', displayVal: string) => {
    const nano = tonDisplayToNano(displayVal)
    updateDraft({ limits: { ...draft.limits, [field]: nano } })
  }

  const handleRemoveSitePolicy = (domain: string) => {
    const updated = draft.sitePolicies.filter((p) => p.domain !== domain)
    updateDraft({ sitePolicies: updated })
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

      {/* HTTP 402 payment settings — collapsible dropdown under wallet management */}
      <div className="mt-6">
        <Collapsible title={t('wallet.http402', { defaultValue: 'HTTP 402' })}>
          {/* Payment mode */}
          <div className="settings-group px-4">
            <SettingRow label={t('wallet.paymentMode')} description={t('wallet.paymentModeDesc')}>
              <Segmented
                value={draft.paymentMode}
                onChange={(v) => updateDraft({ paymentMode: v as PaymentMode })}
                options={[
                  { value: 'off', label: t('wallet.modeOff') },
                  { value: 'manual', label: t('wallet.modeManual') },
                  { value: 'auto', label: t('wallet.modeAuto') },
                ]}
              />
            </SettingRow>
            <SettingRow label={t('wallet.notificationStyle')} description={t('wallet.notificationStyleDesc')}>
              <Segmented
                value={draft.notificationStyle}
                onChange={(v) => updateDraft({ notificationStyle: v as NotificationStyle })}
                options={[
                  { value: 'popup', label: t('wallet.notifPopup') },
                  { value: 'addressbar', label: t('wallet.notifAddressbar') },
                ]}
              />
            </SettingRow>
          </div>

          {/* Spending limits */}
          <div className="settings-group px-4">
            <GroupHeader title={t('wallet.spendingLimits')} description={t('wallet.spendingLimitsDesc')} />

            <SettingRow label={t('wallet.perRequest')} description={t('wallet.perRequestDesc')}>
              <TonStepperField
                value={perRequestDisplay}
                onChange={setPerRequestDisplay}
                onBlur={() => handleLimitBlur('perRequest', perRequestDisplay)}
                ariaLabel={t('wallet.perRequest')}
                step={0.5}
              />
            </SettingRow>

            <SettingRow label={t('wallet.perDay')} description={t('wallet.perDayDesc')}>
              <TonStepperField
                value={perDayDisplay}
                onChange={setPerDayDisplay}
                onBlur={() => handleLimitBlur('perDay', perDayDisplay)}
                ariaLabel={t('wallet.perDay')}
                step={1}
              />
            </SettingRow>

            <SettingRow label={t('wallet.perSitePerMonth')} description={t('wallet.perSitePerMonthDesc')}>
              <TonStepperField
                value={perSiteDisplay}
                onChange={setPerSiteDisplay}
                onBlur={() => handleLimitBlur('perSitePerMonth', perSiteDisplay)}
                ariaLabel={t('wallet.perSitePerMonth')}
                step={1}
              />
            </SettingRow>
          </div>

          {/* Per-site policies */}
          {draft.sitePolicies.length > 0 && (
            <div className="settings-group px-4">
              <GroupHeader title={t('wallet.sitePolicies')} description={t('wallet.sitePoliciesDesc')} />
              <div className="divide-y divide-border">
                {draft.sitePolicies.map((policy: SitePolicy) => (
                  <div key={policy.domain} className="flex items-center gap-3 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{policy.domain}</p>
                      <p className="text-xs text-muted-foreground">
                        {t(`wallet.mode${policy.mode.charAt(0).toUpperCase() + policy.mode.slice(1)}`)}
                        {' · '}
                        {t('wallet.spent')}: {nanoToTonDisplay(policy.totalSpent)} GRAM
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemoveSitePolicy(policy.domain)}
                      aria-label={t('wallet.removeSitePolicy', { domain: policy.domain })}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Collapsible>
      </div>
    </div>
  )
})
