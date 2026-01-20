/**
 * Section Advanced
 */

import { memo } from 'react'
import { RotateCcw } from 'lucide-react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { SelectInput } from '../shared/SelectInput'
import type { SectionProps } from '../types'

interface AdvancedSectionProps extends SectionProps {
  onResetAll: () => void
}

export const AdvancedSection = memo(function AdvancedSection({
  draft,
  setDraft,
  onResetAll,
}: AdvancedSectionProps) {
  return (
    <div>
      <SectionHeader title="Advanced" description="Settings for developers and power users" />
      <div className="bg-card rounded-xl border border-border px-4">
        <SettingRow label="Proxy verbosity" description="Logging level for proxy daemon">
          <SelectInput
            value={String(draft.proxyVerbosity)}
            onChange={(v) => setDraft('proxyVerbosity', Number(v))}
            options={[
              { value: '0', label: 'Silent' },
              { value: '1', label: 'Errors only' },
              { value: '2', label: 'Normal' },
              { value: '3', label: 'Verbose' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Storage verbosity" description="Logging level for storage daemon">
          <SelectInput
            value={String(draft.storageVerbosity)}
            onChange={(v) => setDraft('storageVerbosity', Number(v))}
            options={[
              { value: '0', label: 'Silent' },
              { value: '1', label: 'Errors only' },
              { value: '2', label: 'Normal' },
              { value: '3', label: 'Verbose' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Sync test domain" description="Domain used to verify DHT sync">
          <input
            value={draft.syncTestDomain}
            onChange={(e) => setDraft('syncTestDomain', e.target.value)}
            placeholder="tonnet-sync-check.ton"
            className="w-40 px-3 py-1.5 rounded-full text-sm text-foreground outline-none bg-surface-hover border border-border-medium"
          />
        </SettingRow>
      </div>

      <div className="mt-6">
        <button
          onClick={onResetAll}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 bg-destructive/15 border border-destructive/30 text-destructive hover:bg-destructive/25"
        >
          <RotateCcw className="h-4 w-4" />
          Reset all settings to defaults
        </button>
      </div>
    </div>
  )
})
