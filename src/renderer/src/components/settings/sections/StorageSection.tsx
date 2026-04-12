/**
 * Section TON Storage
 */

import { memo } from 'react'
import { FolderOpen } from 'lucide-react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { Toggle } from '../shared/Toggle'
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
        <SettingRow label={t('storage.seedingEnabled')} description={t('storage.seedingEnabledDesc')}>
          <Toggle
            checked={draft.seedingEnabled}
            onChange={(v) => setDraft('seedingEnabled', v)}
            label={t('storage.seedingEnabledLabel')}
          />
        </SettingRow>
        <SettingRow label={t('storage.downloadSpeedLimit')} description={t('storage.downloadSpeedLimitDesc')}>
          <NumberInput
            value={Math.round(draft.downloadSpeedLimit / 1024)}
            onChange={(v) => setDraft('downloadSpeedLimit', v * 1024)}
            min={0}
            max={102400}
            step={128}
            suffix=" KB/s"
          />
        </SettingRow>
        <SettingRow label={t('storage.uploadSpeedLimit')} description={t('storage.uploadSpeedLimitDesc')}>
          <NumberInput
            value={Math.round(draft.uploadSpeedLimit / 1024)}
            onChange={(v) => setDraft('uploadSpeedLimit', v * 1024)}
            min={0}
            max={102400}
            step={128}
            suffix=" KB/s"
          />
        </SettingRow>
      </div>

      <div className="mt-6 glass-card px-4">
        <SettingRow label={t('storage.downloadFolder')} description={t('storage.downloadFolderDesc')}>
          <button
            onClick={onSelectFolder}
            className="flex items-center gap-2 max-w-[240px] px-3 py-1.5 rounded-full text-sm text-muted-foreground bg-surface-hover border border-border-medium transition-all duration-200 hover:border-foreground-muted hover:text-foreground cursor-pointer"
            title={draft.downloadPath || undefined}
          >
            <span className="truncate">
              {!isLoaded ? t('storage.loading') : draft.downloadPath || t('storage.notSet')}
            </span>
            <FolderOpen className="h-4 w-4 shrink-0" />
          </button>
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
