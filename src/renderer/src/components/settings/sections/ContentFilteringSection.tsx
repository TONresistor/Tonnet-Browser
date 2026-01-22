/**
 * Content Filtering Section
 */

import { memo, useState } from 'react'
import { Shield, Plus, X } from 'lucide-react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { Toggle } from '../shared/Toggle'
import type { SectionProps } from '../types'
import { useTranslation } from 'react-i18next'

export const ContentFilteringSection = memo(function ContentFilteringSection({
  draft,
  setDraft,
}: SectionProps) {
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
    setDraft('whitelistedDomains', draft.whitelistedDomains.filter((d) => d !== domain))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddDomain()
    }
  }

  return (
    <div>
      <SectionHeader
        title={t('contentFiltering.title')}
        description={t('contentFiltering.description')}
      />
      <div className="bg-card rounded-xl border border-border px-4">
        <SettingRow
          label={t('contentFiltering.enableFiltering')}
          description={t('contentFiltering.enableFilteringDesc')}
        >
          <Toggle
            checked={draft.contentFilteringEnabled}
            onChange={(v) => setDraft('contentFilteringEnabled', v)}
            label={t('contentFiltering.enableFilteringLabel')}
          />
        </SettingRow>

        {draft.contentFilteringEnabled && (
          <>
            <SettingRow
              label={t('contentFiltering.blockAds')}
              description={t('contentFiltering.blockAdsDesc')}
            >
              <Toggle
                checked={draft.blockAds}
                onChange={(v) => setDraft('blockAds', v)}
                label={t('contentFiltering.blockAdsLabel')}
              />
            </SettingRow>

            <SettingRow
              label={t('contentFiltering.blockTrackers')}
              description={t('contentFiltering.blockTrackersDesc')}
            >
              <Toggle
                checked={draft.blockTrackers}
                onChange={(v) => setDraft('blockTrackers', v)}
                label={t('contentFiltering.blockTrackersLabel')}
              />
            </SettingRow>

            <SettingRow
              label={t('contentFiltering.blockMiners')}
              description={t('contentFiltering.blockMinersDesc')}
            >
              <Toggle
                checked={draft.blockMiners}
                onChange={(v) => setDraft('blockMiners', v)}
                label={t('contentFiltering.blockMinersLabel')}
              />
            </SettingRow>

            <SettingRow
              label={t('contentFiltering.blockMalware')}
              description={t('contentFiltering.blockMalwareDesc')}
            >
              <Toggle
                checked={draft.blockMalware}
                onChange={(v) => setDraft('blockMalware', v)}
                label={t('contentFiltering.blockMalwareLabel')}
              />
            </SettingRow>

            <SettingRow
              label={t('contentFiltering.blockAnnoyances')}
              description={t('contentFiltering.blockAnnoyancesDesc')}
            >
              <Toggle
                checked={draft.blockAnnoyances}
                onChange={(v) => setDraft('blockAnnoyances', v)}
                label={t('contentFiltering.blockAnnoyancesLabel')}
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
          </>
        )}
      </div>
    </div>
  )
})
