import { memo, useCallback, useEffect, useState } from 'react'
import { Trash2, LoaderCircle, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WalletSettings, PaymentMode, NotificationStyle, SitePolicy } from '@shared/types'
import { SettingRow } from '../shared/SettingRow'
import { Toggle } from '../shared/Toggle'
import { GroupHeader } from '../shared/GroupHeader'
import { TonStepperField } from '../shared/TonStepperField'
import { Segmented } from '@/components/ui/ios/Segmented'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/logger'
import { formatTonAmount, tonToNano } from '@/lib/ton-utils'
import { walletClient } from '@/features/wallet/client'
import { useSectionHandle } from '@/hooks/useSectionHandle'
import { cn } from '@/lib/utils'

const log = createLogger('http402-settings')

type Http402Settings = Pick<
  WalletSettings,
  'paymentMode' | 'notificationStyle' | 'limits' | 'sitePolicies' | 'autoPayDomains'
>

const DEFAULT_HTTP402_SETTINGS: Http402Settings = {
  paymentMode: 'off',
  notificationStyle: 'popup',
  limits: { perRequest: '0', perDay: '0', perSitePerMonth: '0' },
  sitePolicies: [],
  autoPayDomains: [],
}

export interface Http402SectionHandle {
  save: () => Promise<void>
  discard: () => void
  hasChanges: boolean
}

interface Http402ExperimentalPanelProps {
  onDirtyChange?: (dirty: boolean) => void
  sectionRef?: React.RefObject<Http402SectionHandle | null>
}

function pickHttp402Settings(settings: WalletSettings): Http402Settings {
  return {
    paymentMode: settings.paymentMode,
    notificationStyle: settings.notificationStyle,
    limits: settings.limits,
    sitePolicies: settings.sitePolicies,
    autoPayDomains: settings.autoPayDomains,
  }
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

function settingsError(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const maybe = result as { success?: unknown; error?: unknown }
  if (maybe.success !== false) return null
  return typeof maybe.error === 'string' ? maybe.error : 'Failed to save HTTP 402 settings'
}

export const Http402ExperimentalPanel = memo(function Http402ExperimentalPanel({
  onDirtyChange,
  sectionRef,
}: Http402ExperimentalPanelProps) {
  const { t } = useTranslation('settings')
  const [saved, setSaved] = useState<Http402Settings>(DEFAULT_HTTP402_SETTINGS)
  const [draft, setDraft] = useState<Http402Settings>(DEFAULT_HTTP402_SETTINGS)
  const [isLoading, setIsLoading] = useState(true)
  const [perRequestDisplay, setPerRequestDisplay] = useState('0')
  const [perDayDisplay, setPerDayDisplay] = useState('0')
  const [perSiteDisplay, setPerSiteDisplay] = useState('0')
  const [detailsOpen, setDetailsOpen] = useState(true)

  const hasChanges = JSON.stringify(saved) !== JSON.stringify(draft)
  const enabled = draft.paymentMode !== 'off'

  const applyDisplayValues = useCallback((settings: Http402Settings) => {
    setPerRequestDisplay(nanoToTonDisplay(settings.limits.perRequest))
    setPerDayDisplay(nanoToTonDisplay(settings.limits.perDay))
    setPerSiteDisplay(nanoToTonDisplay(settings.limits.perSitePerMonth))
  }, [])

  useEffect(() => {
    let active = true
    let canonicalRevision = 0
    let initialized = false
    const off = walletClient.onSettingsChanged((change) => {
      if (!change.settings || (!change.reset && change.category !== 'wallet')) return
      canonicalRevision += 1
      const next = pickHttp402Settings(change.settings.wallet)
      const values = change.values as Partial<WalletSettings> | undefined
      const replaceDraft =
        change.reset ||
        !initialized ||
        !values ||
        ['paymentMode', 'notificationStyle', 'limits', 'sitePolicies', 'autoPayDomains'].some((key) =>
          Object.prototype.hasOwnProperty.call(values, key)
        )
      setSaved(next)
      if (replaceDraft) {
        setDraft(next)
        applyDisplayValues(next)
      }
      setIsLoading(false)
      initialized = true
    })
    const loadRevision = canonicalRevision
    void walletClient
      .getSettings()
      .then((walletSettings) => {
        if (!active || !walletSettings || canonicalRevision !== loadRevision) return
        const next = pickHttp402Settings(walletSettings as WalletSettings)
        setSaved(next)
        setDraft(next)
        applyDisplayValues(next)
        initialized = true
      })
      .catch((err) => {
        if (active) log.error('Failed to load HTTP 402 settings:', err)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
      off()
    }
  }, [applyDisplayValues])

  const updateDraft = (updates: Partial<Http402Settings>) => {
    setDraft((prev) => ({ ...prev, ...updates }))
  }

  const handleEnabledChange = (next: boolean) => {
    updateDraft({ paymentMode: next ? 'manual' : 'off' })
    if (next) setDetailsOpen(true)
  }

  const handleLimitBlur = (field: 'perRequest' | 'perDay' | 'perSitePerMonth', displayVal: string) => {
    const nano = tonDisplayToNano(displayVal)
    updateDraft({ limits: { ...draft.limits, [field]: nano } })
  }

  const handleRemoveSitePolicy = (domain: string) => {
    updateDraft({ sitePolicies: draft.sitePolicies.filter((p) => p.domain !== domain) })
  }

  const saveToMain = useCallback(async () => {
    try {
      const result = await walletClient.updateSettings(draft)
      const error = settingsError(result)
      if (error) throw new Error(error)
      setSaved(draft)
    } catch (err) {
      log.error('Failed to save HTTP 402 settings:', err)
      throw err
    }
  }, [draft])

  const discardChanges = useCallback(() => {
    setDraft(saved)
    applyDisplayValues(saved)
  }, [applyDisplayValues, saved])

  useSectionHandle(sectionRef, { save: saveToMain, discard: discardChanges, hasChanges }, onDirtyChange)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center border-b border-border-subtle py-3.5">
        <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    )
  }

  return (
    <>
      <SettingRow label={t('advanced.experimental.http402')} description={t('advanced.experimental.http402Desc')}>
        <Toggle checked={enabled} onChange={handleEnabledChange} ariaLabel={t('advanced.experimental.http402')} />
      </SettingRow>

      {enabled && (
        <>
          <button
            type="button"
            onClick={() => setDetailsOpen((open) => !open)}
            aria-expanded={detailsOpen}
            className={cn(
              'flex w-full items-center justify-between gap-3 py-3.5 text-left transition-colors hover:text-foreground',
              detailsOpen && 'border-b border-border-subtle'
            )}
          >
            <div className="min-w-0">
              <p className="text-[15px] font-medium text-foreground">{t('advanced.experimental.http402Behavior')}</p>
              <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
                {t('advanced.experimental.http402BehaviorDesc')}
              </p>
            </div>
            <ChevronRight
              className={cn(
                'h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200',
                detailsOpen && 'rotate-90'
              )}
            />
          </button>
          {detailsOpen && (
            <>
              <SettingRow label={t('wallet.paymentMode')} description={t('wallet.paymentModeDesc')}>
                <Segmented
                  value={draft.paymentMode}
                  onChange={(v) => updateDraft({ paymentMode: v as PaymentMode })}
                  options={[
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

              <GroupHeader title={t('wallet.spendingLimits')} description={t('wallet.spendingLimitsDesc')} />

              <SettingRow label={t('wallet.perRequest')} description={t('wallet.perRequestDesc')}>
                <TonStepperField
                  value={perRequestDisplay}
                  onChange={setPerRequestDisplay}
                  onBlur={(v) => handleLimitBlur('perRequest', v ?? perRequestDisplay)}
                  ariaLabel={t('wallet.perRequest')}
                  step={0.5}
                />
              </SettingRow>

              <SettingRow label={t('wallet.perDay')} description={t('wallet.perDayDesc')}>
                <TonStepperField
                  value={perDayDisplay}
                  onChange={setPerDayDisplay}
                  onBlur={(v) => handleLimitBlur('perDay', v ?? perDayDisplay)}
                  ariaLabel={t('wallet.perDay')}
                  step={1}
                />
              </SettingRow>

              <SettingRow label={t('wallet.perSitePerMonth')} description={t('wallet.perSitePerMonthDesc')}>
                <TonStepperField
                  value={perSiteDisplay}
                  onChange={setPerSiteDisplay}
                  onBlur={(v) => handleLimitBlur('perSitePerMonth', v ?? perSiteDisplay)}
                  ariaLabel={t('wallet.perSitePerMonth')}
                  step={1}
                />
              </SettingRow>

              {draft.sitePolicies.length > 0 && (
                <>
                  <GroupHeader title={t('wallet.sitePolicies')} description={t('wallet.sitePoliciesDesc')} />
                  <div className="divide-y divide-border">
                    {draft.sitePolicies.map((policy: SitePolicy) => (
                      <div key={policy.domain} className="flex items-center gap-3 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">{policy.domain}</p>
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
                </>
              )}
            </>
          )}
        </>
      )}
    </>
  )
})
