/**
 * Section Privacy
 */

import { memo } from 'react'
import { Trash2, CircleCheckBig, History as HistoryIcon, Lock } from 'lucide-react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { Toggle } from '../shared/Toggle'
import { ToggleGroup } from '../shared/ToggleGroup'
import { StepperInput } from '../shared/StepperInput'
import { useTabsStore } from '@/stores/tabs'
import type { SectionProps } from '../types'
import { useTranslation } from 'react-i18next'

interface PrivacySectionProps extends SectionProps {
  clearing: boolean
  cleared: boolean
  onClearData: () => void
  changingHistoryMode: boolean
  onHistoryModeChange: (mode: string) => void
}

export const PrivacySection = memo(function PrivacySection({
  draft,
  setDraft,
  clearing,
  cleared,
  onClearData,
  changingHistoryMode,
  onHistoryModeChange,
}: PrivacySectionProps) {
  const { t } = useTranslation('settings')
  const addTab = useTabsStore((state) => state.addTab)

  const historyModeOptions: {
    value: 'memory' | 'persistent'
    label: string
    icon: React.ReactNode
  }[] = [
    { value: 'memory', label: t('history.modeLive'), icon: <HistoryIcon className="h-3.5 w-3.5" /> },
    { value: 'persistent', label: t('history.modePersistent'), icon: <Lock className="h-3.5 w-3.5" /> },
  ]

  const getModeDescription = (mode: string) => {
    switch (mode) {
      case 'memory':
        return t('history.historyModeMemory')
      case 'persistent':
        return t('history.historyModePersistent')
      default:
        return ''
    }
  }

  return (
    <div>
      <SectionHeader title={t('privacy.title')} description={t('privacy.description')} />
      <div className="glass-card px-4">
        <SettingRow label={t('privacy.clearData')} description={t('privacy.clearDataDesc')}>
          <button
            onClick={onClearData}
            disabled={clearing}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 disabled:opacity-50 bg-destructive/90 shadow-[0_4px_16px_var(--destructive-glow)] text-white"
          >
            {clearing ? (
              t('privacy.clearing')
            ) : cleared ? (
              <>
                <CircleCheckBig className="h-4 w-4" /> {t('privacy.done')}
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" /> {t('privacy.clear')}
              </>
            )}
          </button>
        </SettingRow>
        <SettingRow label={t('privacy.disableCache')} description={t('privacy.disableCacheDesc')}>
          <Toggle
            checked={draft.disableCache}
            onChange={(v) => setDraft('disableCache', v)}
            label={t('privacy.disableCacheLabel')}
          />
        </SettingRow>
        <SettingRow label={t('privacy.firstPartyIsolation')} description={t('privacy.firstPartyIsolationDesc')}>
          <Toggle
            checked={draft.firstPartyIsolation}
            onChange={(v) => setDraft('firstPartyIsolation', v)}
            label={t('privacy.firstPartyIsolationLabel')}
          />
        </SettingRow>
        <SettingRow label={t('privacy.cookieAutoDelete')} description={t('privacy.cookieAutoDeleteDesc')}>
          <Toggle
            checked={draft.cookieAutoDelete}
            onChange={(v) => setDraft('cookieAutoDelete', v)}
            label={t('privacy.cookieAutoDeleteLabel')}
          />
        </SettingRow>
        {draft.cookieAutoDelete && (
          <div>
            <SettingRow label={t('privacy.autoDeleteTimeout')} description={t('privacy.autoDeleteTimeoutDesc')}>
              <StepperInput
                value={draft.cookieAutoDeleteMinutes}
                onChange={(v) => setDraft('cookieAutoDeleteMinutes', v)}
                min={1}
                max={1440}
                step={5}
                suffix=" min"
              />
            </SettingRow>
          </div>
        )}
      </div>

      {/* History */}
      <div className="mt-6 glass-card px-4">
        <SettingRow label={t('history.historyMode')} description={getModeDescription(draft.historyMode)}>
          <ToggleGroup
            value={draft.historyMode}
            onChange={(v) => !changingHistoryMode && onHistoryModeChange(v)}
            options={historyModeOptions}
            disabled={changingHistoryMode}
          />
        </SettingRow>
        <SettingRow label={t('history.maxEntries')} description={t('history.maxEntriesDesc')}>
          <StepperInput
            value={draft.historyMaxEntries}
            onChange={(v) => setDraft('historyMaxEntries', v)}
            min={100}
            max={10000}
            step={100}
            editable
          />
        </SettingRow>
        <SettingRow label={t('history.viewHistory')} description={t('history.viewHistoryDesc')}>
          <button
            onClick={() => addTab('ton://history')}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 bg-surface-hover border border-border-medium text-foreground hover:bg-surface-active"
          >
            <HistoryIcon className="h-4 w-4" />
            {t('history.open')}
          </button>
        </SettingRow>
      </div>
    </div>
  )
})
