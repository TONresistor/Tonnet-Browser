/**
 * Cocoon AI settings section.
 */

import { memo, useEffect, useState } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { Toggle } from '../shared/Toggle'
import { RecoveryPanel } from '@/components/cocoon/RecoveryPanel'
import { Button } from '@/components/ui/button'
import { isIpcError } from '@/lib/ipc-utils'
import { useTabsStore } from '@/stores/tabs'
import type { SectionProps } from '../types'
import { useTranslation } from 'react-i18next'

type CocoonContractStatus = {
  label: string
  description: string
}

export const CocoonSection = memo(function CocoonSection({ draft, setDraft }: SectionProps) {
  const { t } = useTranslation('settings')
  const [advancedRecoveryOpen, setAdvancedRecoveryOpen] = useState(false)
  const [contractStatus, setContractStatus] = useState<CocoonContractStatus | null>(null)
  const openOrSwitchToTab = useTabsStore((s) => s.openOrSwitchToTab)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const exists = await window.electron.cocoon.walletExists()
        if (cancelled) return
        if (!exists) {
          setContractStatus({
            label: 'Not configured',
            description: 'Cocoon is not set up yet. Open Cocoon Wallet to create and fund it.',
          })
          return
        }

        const walletInfo = await window.electron.cocoon.walletInfo()
        if (cancelled) return
        if (isIpcError(walletInfo) || !walletInfo || walletInfo.setupCompletedAt == null) {
          setContractStatus({
            label: 'Not configured',
            description: 'No active Cocoon contract yet. Resume setup from Cocoon Wallet.',
          })
          return
        }

        const stakeInfo = await window.electron.cocoon.stakeInfo()
        if (cancelled) return
        if (isIpcError(stakeInfo) || !stakeInfo || stakeInfo.status === 'closed') {
          setContractStatus({
            label: 'No active contract',
            description: 'Cocoon is set up locally, but no active stake contract is running.',
          })
          return
        }

        if (stakeInfo.status === 'active') {
          setContractStatus({
            label: 'Active',
            description: 'Cocoon has an active stake contract. Manage funds from Cocoon Wallet.',
          })
          return
        }

        setContractStatus({
          label: 'Deactivating',
          description: 'The previous Cocoon contract is being deactivated or drained.',
        })
      } catch {
        if (!cancelled) {
          setContractStatus({
            label: 'Unavailable',
            description: 'Open Cocoon Wallet to inspect the current setup state.',
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <SectionHeader title={t('cocoon.title')} description={t('cocoon.description')} />

        <div className="settings-group px-4">
          <SettingRow label={t('cocoon.autostart')} description={t('cocoon.autostartDesc')}>
            <Toggle
              checked={draft.cocoonAutostart}
              onChange={(v) => setDraft('cocoonAutostart', v)}
              ariaLabel={t('cocoon.autostart')}
            />
          </SettingRow>
          <SettingRow label="Cocoon contract" description={contractStatus?.description ?? 'Checking Cocoon state…'}>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-8 items-center text-sm text-muted-foreground whitespace-nowrap">
                {contractStatus ? (
                  contractStatus.label
                ) : (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Checking
                  </>
                )}
              </span>
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-md border-0 bg-accent/55 px-3 text-foreground shadow-none hover:bg-accent/75 hover:text-foreground whitespace-nowrap"
                onClick={() => openOrSwitchToTab('ton://cocoon')}
              >
                Open Cocoon Wallet
              </Button>
            </div>
          </SettingRow>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-elevation-1">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
          aria-expanded={advancedRecoveryOpen}
          onClick={() => setAdvancedRecoveryOpen((v) => !v)}
        >
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-foreground">{t('cocoon.recovery.sectionTitle')}</h4>
            <p className="mt-0.5 text-xs text-muted-foreground truncate">{t('cocoon.recovery.sectionDesc')}</p>
          </div>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${advancedRecoveryOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {advancedRecoveryOpen && (
          <div className="border-t border-border px-4 py-4">
            <RecoveryPanel />
          </div>
        )}
      </div>
    </div>
  )
})
