/**
 * Section TON Storage
 */

import { memo } from 'react'
import { FolderOpen } from 'lucide-react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { NumberInput } from '../shared/NumberInput'
import type { SectionProps } from '../types'

interface StorageSectionProps extends SectionProps {
  isLoaded: boolean
  onSelectFolder: () => void
}

export const StorageSection = memo(function StorageSection({
  draft,
  setDraft,
  isLoaded,
  onSelectFolder,
}: StorageSectionProps) {
  return (
    <div>
      <SectionHeader
        title="TON Storage"
        description="Configure decentralized storage settings"
      />
      <div className="bg-card rounded-xl border border-border px-4">
        <SettingRow label="Download folder" description="Where TON Storage files are saved">
          <div className="flex items-center gap-2">
            <div className="max-w-[200px] px-3 py-1.5 rounded-full text-sm text-muted-foreground truncate bg-surface-hover border border-border-medium">
              {!isLoaded ? 'Loading...' : draft.downloadPath || 'Not set'}
            </div>
            <button
              onClick={onSelectFolder}
              className="shrink-0 p-2 rounded-full transition-all duration-200 hover:text-foreground bg-surface-hover border border-border-medium text-foreground-muted"
            >
              <FolderOpen className="h-4 w-4" />
            </button>
          </div>
        </SettingRow>
        <SettingRow label="Update interval" description="How often to refresh download stats">
          <NumberInput
            value={draft.storagePollingInterval}
            onChange={(v) => setDraft('storagePollingInterval', v)}
            min={500}
            max={10000}
            step={500}
            suffix="ms"
          />
        </SettingRow>
      </div>
    </div>
  )
})
