/**
 * Section Advanced
 */

import { memo } from 'react'
import { RotateCcw } from 'lucide-react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { SelectInput } from '../shared/SelectInput'
import type { SectionProps } from '../types'
import { useTranslation } from 'react-i18next'

interface AdvancedSectionProps extends SectionProps {
  onResetAll: () => void
  pendingReset?: boolean
}

export const AdvancedSection = memo(function AdvancedSection({
  draft,
  setDraft,
  onResetAll,
  pendingReset,
}: AdvancedSectionProps) {
  const { t } = useTranslation('settings')

  return (
    <div>
      <SectionHeader title={t('advanced.title')} description={t('advanced.description')} />
      <div className="bg-card rounded-xl border border-border px-4">
        <SettingRow label={t('advanced.proxyVerbosity')} description={t('advanced.proxyVerbosityDesc')}>
          <SelectInput
            value={String(draft.proxyVerbosity)}
            onChange={(v) => setDraft('proxyVerbosity', Number(v))}
            options={[
              { value: '0', label: t('advanced.silent') },
              { value: '1', label: t('advanced.errorsOnly') },
              { value: '2', label: t('advanced.normal') },
              { value: '3', label: t('advanced.verbose') },
            ]}
          />
        </SettingRow>
        <SettingRow label={t('advanced.storageVerbosity')} description={t('advanced.storageVerbosityDesc')}>
          <SelectInput
            value={String(draft.storageVerbosity)}
            onChange={(v) => setDraft('storageVerbosity', Number(v))}
            options={[
              { value: '0', label: t('advanced.silent') },
              { value: '1', label: t('advanced.errorsOnly') },
              { value: '2', label: t('advanced.normal') },
              { value: '3', label: t('advanced.verbose') },
            ]}
          />
        </SettingRow>
        <SettingRow label={t('advanced.syncTestDomain')} description={t('advanced.syncTestDomainDesc')}>
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
          className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 border text-destructive ${
            pendingReset
              ? 'bg-destructive/30 border-destructive/60'
              : 'bg-destructive/15 border-destructive/30 hover:bg-destructive/25'
          }`}
        >
          <RotateCcw className="h-4 w-4" />
          {pendingReset ? t('advanced.resetAllConfirm') : t('advanced.resetAll')}
        </button>
      </div>
    </div>
  )
})
