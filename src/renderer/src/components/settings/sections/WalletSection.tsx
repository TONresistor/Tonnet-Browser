/**
 * Wallet settings section.
 * Uses a local draft that integrates with the global Save/Discard flow
 * via onDirtyChange/onSave/onDiscard callbacks.
 */

import { memo, useState, useEffect, useCallback } from 'react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { ToggleGroup } from '../shared/ToggleGroup'
import { UI_COPY_FEEDBACK_MS } from '@shared/constants'
import { createLogger } from '@/logger'
import { useTranslation } from 'react-i18next'
import type { WalletSettings, PaymentMode, NotificationStyle, SitePolicy } from '@shared/types'
import {
  Trash2,
  LoaderCircle,
  Eye,
  EyeOff,
  Upload,
  KeyRound,
  Copy,
  Check,
  AlertTriangle,
  Minus,
  Plus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { tonToNano, formatTonAmount, useWalletStore } from '@/stores/wallet'
import { cn } from '@/lib/utils'

const log = createLogger('wallet-settings')
const MNEMONIC_CLEAR_TIMEOUT = 60_000

function WalletManagementSection() {
  const { t } = useTranslation('wallet')
  const { isCreated, importWallet, exportMnemonic, isLoading } = useWalletStore()
  const [words, setWords] = useState<string[] | null>(null)
  const [isRevealed, setIsRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportLoading, setExportLoading] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importInput, setImportInput] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)

  const handleReveal = useCallback(async () => {
    if (isRevealed) {
      setIsRevealed(false)
      setWords(null)
      return
    }
    setExportLoading(true)
    setExportError(null)
    try {
      const mnemonic = await exportMnemonic()
      setWords(mnemonic)
      setIsRevealed(true)
      setTimeout(() => {
        setWords(null)
        setIsRevealed(false)
      }, MNEMONIC_CLEAR_TIMEOUT)
    } catch (err) {
      setExportError((err as Error).message)
    } finally {
      setExportLoading(false)
    }
  }, [isRevealed, exportMnemonic])

  const handleCopy = useCallback(() => {
    if (!words) return
    navigator.clipboard.writeText(words.join(' '))
    setCopied(true)
    setTimeout(() => setCopied(false), UI_COPY_FEEDBACK_MS)
  }, [words])

  const parseWords = (text: string): string[] =>
    text
      .trim()
      .split(/[\s,]+/)
      .filter((w) => w.length > 0)
  const wordCount = parseWords(importInput).length

  const handleImport = useCallback(async () => {
    const parsed = parseWords(importInput)
    if (parsed.length !== 24) {
      setImportError(t('import.error'))
      return
    }
    if (isCreated && !showConfirm) {
      setShowConfirm(true)
      return
    }
    setImportError(null)
    setShowConfirm(false)
    try {
      await importWallet(parsed)
      setImportInput('')
      setShowImport(false)
    } catch (err) {
      setImportError((err as Error).message)
    }
  }, [importInput, isCreated, showConfirm, importWallet, t])

  return (
    <div className="mt-6 glass-card px-4 py-4 space-y-4">
      <p className="text-foreground font-medium">{t('settings.walletManagement')}</p>

      {/* Export mnemonic */}
      {isCreated && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground flex items-center gap-2">
              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
              {t('export.title')}
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={handleReveal} disabled={exportLoading}>
              {exportLoading ? (
                <LoaderCircle className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden="true" />
              ) : isRevealed ? (
                <EyeOff className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
              ) : (
                <Eye className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
              )}
              {isRevealed ? t('export.hideButton') : t('export.showButton')}
            </Button>
          </div>

          {exportError && <p className="text-xs text-destructive">{exportError}</p>}

          {isRevealed && words && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 p-3 bg-warning/10 border border-warning/20 rounded-lg">
                <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" aria-hidden="true" />
                <p className="text-xs text-warning">{t('export.warning')}</p>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {words.map((word, i) => (
                  <div key={i} className="flex items-center gap-1.5 px-2 py-1.5 bg-muted rounded text-xs">
                    <span className="text-muted-foreground w-5 text-right">{i + 1}.</span>
                    <span className="font-mono text-foreground">{word}</span>
                  </div>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={handleCopy} className="w-full">
                {copied ? <Check className="h-3.5 w-3.5 mr-1.5" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
                {copied ? t('export.copied') : t('receive.copyButton')}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Import wallet */}
      <div className="border-t border-border pt-4">
        {!showImport ? (
          <button
            type="button"
            className="text-sm text-primary hover:underline flex items-center gap-2"
            onClick={() => setShowImport(true)}
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            {isCreated ? t('import.title') : t('create.orImport')}
          </button>
        ) : showConfirm ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" aria-hidden="true" />
              <p className="text-sm text-destructive">{t('import.confirm')}</p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="destructive"
                onClick={handleImport}
                disabled={isLoading}
                className="flex-1"
              >
                {isLoading && <LoaderCircle className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />}
                {t('import.confirmButton')}
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowConfirm(false)} className="flex-1">
                {t('import.cancelButton')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{t('import.title')}</span>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setShowImport(false)
                  setImportInput('')
                  setImportError(null)
                }}
              >
                {t('import.cancelButton')}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">{t('import.description')}</p>
            <textarea
              className={cn(
                'w-full h-24 p-3 text-sm rounded-lg border bg-background text-foreground resize-none',
                'focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground'
              )}
              placeholder={t('import.placeholder')}
              value={importInput}
              onChange={(e) => {
                setImportInput(e.target.value)
                setImportError(null)
              }}
              spellCheck={false}
              autoComplete="off"
            />
            <div className="flex items-center justify-between">
              <span className={cn('text-xs', wordCount === 24 ? 'text-success' : 'text-muted-foreground')}>
                {wordCount}/24
              </span>
              {importError && <span className="text-xs text-destructive">{importError}</span>}
            </div>
            <Button type="button" onClick={handleImport} disabled={isLoading || wordCount !== 24} className="w-full">
              {isLoading ? (
                <LoaderCircle className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
              ) : (
                <Upload className="h-4 w-4 mr-2" aria-hidden="true" />
              )}
              {isLoading ? t('import.importing') : t('import.button')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

const DEFAULT_WALLET_SETTINGS: WalletSettings = {
  paymentMode: 'manual',
  notificationStyle: 'banner',
  limits: { perRequest: '0', perDay: '0', perSitePerMonth: '0' },
  sitePolicies: [],
  autoPayDomains: [],
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

function TonStepperField({
  value,
  onValueChange,
  onBlur,
  ariaLabel,
  step = 0.5,
}: {
  value: string
  onValueChange: (v: string) => void
  onBlur: () => void
  ariaLabel: string
  step?: number
}) {
  const numVal = parseFloat(value) || 0
  const decrement = () => {
    const next = Math.max(0, numVal - step)
    const display = Number.isInteger(next) ? String(next) : next.toFixed(1)
    onValueChange(display)
  }
  const increment = () => {
    const next = numVal + step
    const display = Number.isInteger(next) ? String(next) : next.toFixed(1)
    onValueChange(display)
  }

  return (
    <div className="flex items-center gap-2">
      <div className="relative w-24">
        <Input
          value={value}
          onChange={(e) => {
            if (/^(\d*\.?\d*)$/.test(e.target.value)) onValueChange(e.target.value)
          }}
          onBlur={onBlur}
          inputMode="decimal"
          className="pr-10 text-right"
          aria-label={ariaLabel}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
          TON
        </span>
      </div>
      <div className="inline-flex items-center rounded-full bg-surface-hover border border-border-medium h-8">
        <button
          type="button"
          onClick={() => {
            decrement()
            onBlur()
          }}
          disabled={numVal <= 0}
          className="flex items-center justify-center w-9 h-full rounded-l-full text-foreground hover:bg-border/50 disabled:opacity-30 transition-colors"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <div className="w-px h-5 bg-border" />
        <button
          type="button"
          onClick={() => {
            increment()
            onBlur()
          }}
          className="flex items-center justify-center w-9 h-full rounded-r-full text-foreground hover:bg-border/50 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
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
              { value: 'banner', label: t('wallet.notifBanner') },
              { value: 'modal', label: t('wallet.notifModal') },
              { value: 'toast', label: t('wallet.notifToast') },
              { value: 'panel', label: t('wallet.notifPanel') },
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
