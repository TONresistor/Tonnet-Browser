/**
 * Section Advanced
 */

import { memo, useState } from 'react'
import { RotateCcw, Plus, X } from 'lucide-react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { Toggle } from '../shared/Toggle'
import { Segmented } from '@/components/ui/ios/Segmented'
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
  const [newDomain, setNewDomain] = useState('')

  const handleAddDomain = () => {
    const domain = newDomain.trim().toLowerCase()
    if (domain && !draft.whitelistedDomains.includes(domain)) {
      setDraft('whitelistedDomains', [...draft.whitelistedDomains, domain])
      setNewDomain('')
    }
  }

  const handleRemoveDomain = (domain: string) => {
    setDraft(
      'whitelistedDomains',
      draft.whitelistedDomains.filter((d) => d !== domain)
    )
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddDomain()
    }
  }

  return (
    <div>
      <SectionHeader title={t('advanced.title')} description={t('advanced.description')} />
      <div className="settings-group px-4">
        <SettingRow label={t('advanced.proxyVerbosity')} description={t('advanced.proxyVerbosityDesc')}>
          <Segmented
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
          <Segmented
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

      {/* Content Filtering */}
      <div className="mt-6 settings-group px-4">
        <SettingRow
          label={t('contentFiltering.enableFiltering')}
          description={t('contentFiltering.enableFilteringDesc')}
        >
          <Toggle
            checked={draft.contentFilteringEnabled}
            onChange={(v) => setDraft('contentFilteringEnabled', v)}
            ariaLabel={t('contentFiltering.enableFilteringLabel')}
          />
        </SettingRow>
        <SettingRow label={t('contentFiltering.blockAds')} description={t('contentFiltering.blockAdsDesc')}>
          <Toggle
            checked={draft.blockAds}
            onChange={(v) => setDraft('blockAds', v)}
            ariaLabel={t('contentFiltering.blockAdsLabel')}
          />
        </SettingRow>
        <SettingRow label={t('contentFiltering.blockTrackers')} description={t('contentFiltering.blockTrackersDesc')}>
          <Toggle
            checked={draft.blockTrackers}
            onChange={(v) => setDraft('blockTrackers', v)}
            ariaLabel={t('contentFiltering.blockTrackersLabel')}
          />
        </SettingRow>
        <SettingRow label={t('contentFiltering.blockMiners')} description={t('contentFiltering.blockMinersDesc')}>
          <Toggle
            checked={draft.blockMiners}
            onChange={(v) => setDraft('blockMiners', v)}
            ariaLabel={t('contentFiltering.blockMinersLabel')}
          />
        </SettingRow>
        <SettingRow label={t('contentFiltering.blockMalware')} description={t('contentFiltering.blockMalwareDesc')}>
          <Toggle
            checked={draft.blockMalware}
            onChange={(v) => setDraft('blockMalware', v)}
            ariaLabel={t('contentFiltering.blockMalwareLabel')}
          />
        </SettingRow>
        <SettingRow
          label={t('contentFiltering.blockAnnoyances')}
          description={t('contentFiltering.blockAnnoyancesDesc')}
        >
          <Toggle
            checked={draft.blockAnnoyances}
            onChange={(v) => setDraft('blockAnnoyances', v)}
            ariaLabel={t('contentFiltering.blockAnnoyancesLabel')}
          />
        </SettingRow>
        <SettingRow
          label={t('contentFiltering.whitelistedDomains')}
          description={t('contentFiltering.whitelistedDomainsDesc')}
        >
          <div className="flex flex-col gap-2 w-full max-w-md">
            <div className="flex gap-2">
              <input
                type="text"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('contentFiltering.domainPlaceholder')}
                className="flex-1 px-3 py-1.5 rounded-lg border border-border bg-background text-foreground text-sm"
              />
              <button
                onClick={handleAddDomain}
                disabled={!newDomain.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" />
                {t('contentFiltering.add')}
              </button>
            </div>
            {draft.whitelistedDomains.length > 0 && (
              <div className="flex flex-col gap-1 mt-2">
                {draft.whitelistedDomains.map((domain) => (
                  <div
                    key={domain}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted text-foreground text-sm"
                  >
                    <span>{domain}</span>
                    <button
                      onClick={() => handleRemoveDomain(domain)}
                      className="text-destructive hover:text-destructive/80 transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
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
