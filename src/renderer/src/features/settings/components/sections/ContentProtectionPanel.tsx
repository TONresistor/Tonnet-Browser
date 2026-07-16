import { memo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Collapsible } from '../shared/Collapsible'
import { SettingRow } from '../shared/SettingRow'
import { Toggle } from '../shared/Toggle'
import type { SectionProps } from '../types'

export const ContentProtectionPanel = memo(function ContentProtectionPanel({ draft, setDraft }: SectionProps) {
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
    <Collapsible title={t('contentFiltering.title')} description={t('contentFiltering.description')}>
      <SettingRow label={t('contentFiltering.enableFiltering')} description={t('contentFiltering.enableFilteringDesc')}>
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
      <SettingRow label={t('contentFiltering.blockAnnoyances')} description={t('contentFiltering.blockAnnoyancesDesc')}>
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
        <div className="flex w-full max-w-md flex-col gap-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('contentFiltering.domainPlaceholder')}
              className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
            />
            <button
              onClick={handleAddDomain}
              disabled={!newDomain.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-identity-foreground transition-all duration-200 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {t('contentFiltering.add')}
            </button>
          </div>
          {draft.whitelistedDomains.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {draft.whitelistedDomains.map((domain) => (
                <div
                  key={domain}
                  className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm text-foreground"
                >
                  <span>{domain}</span>
                  <button
                    onClick={() => handleRemoveDomain(domain)}
                    className="text-destructive transition-colors hover:text-destructive/80"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </SettingRow>
    </Collapsible>
  )
})
