/**
 * Section TON Storage
 */

import { memo } from 'react'
import { FolderOpen } from 'lucide-react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { NumberInput } from '../shared/NumberInput'
import type { SectionProps } from '../types'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation('settings')

  return (
    <div>
      <SectionHeader title={t('storage.title')} description={t('storage.description')} />
      <div className="glass-card px-4">
        <SettingRow label={t('storage.downloadFolder')} description={t('storage.downloadFolderDesc')}>
          <div className="flex items-center gap-2">
            <input
              type="text"
              defaultValue={draft.downloadPath || ''}
              onBlur={(e) => setDraft('downloadPath', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur()
                }
              }}
              placeholder="/path/to/folder"
              disabled={!isLoaded}
              className="w-56 px-3 py-1.5 rounded-full text-sm text-foreground outline-none bg-surface-hover border border-border-medium disabled:opacity-50"
            />
            <button
              onClick={onSelectFolder}
              className="shrink-0 p-2 rounded-full transition-all duration-200 hover:text-foreground bg-surface-hover border border-border-medium text-foreground-muted"
              title="Browse"
            >
              <FolderOpen className="h-4 w-4" />
            </button>
          </div>
        </SettingRow>
        <SettingRow label={t('storage.updateInterval')} description={t('storage.updateIntervalDesc')}>
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
