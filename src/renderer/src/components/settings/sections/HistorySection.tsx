/**
 * Section History
 */

import { memo } from 'react'
import { History as HistoryIcon, Lock } from 'lucide-react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { ToggleGroup } from '../shared/ToggleGroup'
import { NumberInput } from '../shared/NumberInput'
import { useTabsStore } from '@/stores/tabs'
import type { SectionProps } from '../types'

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
  const addTab = useTabsStore((state) => state.addTab)

  const historyModeOptions: {
    value: 'memory' | 'persistent'
    label: string
    icon: React.ReactNode
  }[] = [
    { value: 'memory', label: 'Live', icon: <HistoryIcon className="h-3.5 w-3.5" /> },
    { value: 'persistent', label: 'Persistent', icon: <Lock className="h-3.5 w-3.5" /> },
  ]

  const getModeDescription = (mode: string) => {
    switch (mode) {
      case 'memory':
        return 'RAM only, cleared on exit'
      case 'persistent':
        return 'Auto-encrypted on disk via OS keychain'
      default:
        return ''
    }
  }

  return (
    <div>
      <SectionHeader title="History" description="Configure browsing history storage" />
      <div className="bg-card rounded-xl border border-border px-4">
        <SettingRow label="History mode" description={getModeDescription(draft.historyMode)}>
          <ToggleGroup
            value={draft.historyMode}
            onChange={(v) => !changingHistoryMode && onHistoryModeChange(v)}
            options={historyModeOptions}
            disabled={changingHistoryMode}
          />
        </SettingRow>
        <SettingRow label="Maximum entries" description="Limit stored history entries">
          <NumberInput
            value={draft.historyMaxEntries}
            onChange={(v) => setDraft('historyMaxEntries', v)}
            min={100}
            max={10000}
            step={100}
          />
        </SettingRow>
        <SettingRow label="View history" description="Open browsing history page">
          <button
            onClick={() => addTab('ton://history')}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 bg-surface-hover border border-border-medium text-foreground hover:bg-surface-active"
          >
            <HistoryIcon className="h-4 w-4" />
            Open
          </button>
        </SettingRow>
      </div>
    </div>
  )
})
