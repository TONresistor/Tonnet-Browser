/**
 * Wallet settings section.
 * Uses a local draft that integrates with the global Save/Discard flow
 * via onDirtyChange/onSave/onDiscard callbacks.
 */

import { memo, useState, useEffect, useCallback } from 'react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { ToggleGroup } from '../shared/ToggleGroup'
import { createLogger } from '@/logger'
import { useTranslation } from 'react-i18next'
import type { WalletSettings, PaymentMode, NotificationStyle, SitePolicy } from '@shared/types'
import { Trash2, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { tonToNano, formatTonAmount } from '@/stores/wallet'
import { WalletManagementSection } from './WalletManagementSection'
import { TonStepperField } from './TonStepperField'

const log = createLogger('wallet-settings')

const DEFAULT_WALLET_SETTINGS: WalletSettings = {
  paymentMode: 'manual',
  notificationStyle: 'popup',
  limits: { perRequest: '0', perDay: '0', perSitePerMonth: '0' },
  sitePolicies: [],
  autoPayDomains: [],
  autoLockMinutes: 5,
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

  // Notify parent of dirty state
  useEffect(() => {
    onDirtyChange?.(hasChanges)
  }, [hasChanges, onDirtyChange])

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

  // Expose save/discard to parent via ref
  useEffect(() => {
    if (sectionRef) {
      ;(sectionRef as React.MutableRefObject<WalletSectionHandle | null>).current = {
        save: saveToMain,
        discard: discardChanges,
        hasChanges,
      }
    }
  }, [sectionRef, saveToMain, discardChanges, hasChanges])

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

      {/* Payment mode */}
      <div className="glass-card px-4">
        <SettingRow label={t('wallet.paymentMode')} description={t('wallet.paymentModeDesc')}>
          <ToggleGroup
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
          <ToggleGroup
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
      <div className="mt-6 glass-card px-4">
        <div className="py-4 border-b border-border">
          <p className="text-foreground font-medium mb-0.5">{t('wallet.spendingLimits')}</p>
          <p className="text-muted-foreground text-sm">{t('wallet.spendingLimitsDesc')}</p>
        </div>

        <SettingRow label={t('wallet.perRequest')} description={t('wallet.perRequestDesc')}>
          <TonStepperField
            value={perRequestDisplay}
            onValueChange={setPerRequestDisplay}
            onBlur={() => handleLimitBlur('perRequest', perRequestDisplay)}
            ariaLabel={t('wallet.perRequest')}
            step={0.5}
          />
        </SettingRow>

        <SettingRow label={t('wallet.perDay')} description={t('wallet.perDayDesc')}>
          <TonStepperField
            value={perDayDisplay}
            onValueChange={setPerDayDisplay}
            onBlur={() => handleLimitBlur('perDay', perDayDisplay)}
            ariaLabel={t('wallet.perDay')}
            step={1}
          />
        </SettingRow>

        <SettingRow label={t('wallet.perSitePerMonth')} description={t('wallet.perSitePerMonthDesc')}>
          <TonStepperField
            value={perSiteDisplay}
            onValueChange={setPerSiteDisplay}
            onBlur={() => handleLimitBlur('perSitePerMonth', perSiteDisplay)}
            ariaLabel={t('wallet.perSitePerMonth')}
            step={1}
          />
        </SettingRow>
      </div>

      {/* Wallet management: export / import */}
      <WalletManagementSection />

      {/* Per-site policies */}
      {draft.sitePolicies.length > 0 && (
        <div className="mt-6 glass-card px-4">
          <div className="py-4 border-b border-border">
            <p className="text-foreground font-medium">{t('wallet.sitePolicies')}</p>
            <p className="text-muted-foreground text-sm mt-0.5">{t('wallet.sitePoliciesDesc')}</p>
          </div>
          <div className="divide-y divide-border">
            {draft.sitePolicies.map((policy: SitePolicy) => (
              <div key={policy.domain} className="flex items-center gap-3 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{policy.domain}</p>
                  <p className="text-xs text-muted-foreground">
                    {t(`wallet.mode${policy.mode.charAt(0).toUpperCase() + policy.mode.slice(1)}`)}
                    {' · '}
                    {t('wallet.spent')}: {nanoToTonDisplay(policy.totalSpent)} TON
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
    </div>
  )
})
