/**
 * Section History
 */

import { memo } from 'react'
import { History as HistoryIcon, Lock } from 'lucide-react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { ToggleGroup } from '../shared/ToggleGroup'
import { StepperInput } from '../shared/StepperInput'
import { useTabsStore } from '@/stores/tabs'
import type { SectionProps } from '../types'
import { useTranslation } from 'react-i18next'

interface HistorySectionProps extends SectionProps {
  changingHistoryMode: boolean
  onHistoryModeChange: (mode: string) => void
}

export const HistorySection = memo(function HistorySection({
  draft,
  setDraft,
  changingHistoryMode,
  onHistoryModeChange,
}: HistorySectionProps) {
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
      <SectionHeader title={t('history.title')} description={t('history.description')} />
      <div className="glass-card px-4">
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
