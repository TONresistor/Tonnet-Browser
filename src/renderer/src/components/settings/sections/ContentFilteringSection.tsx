/**
 * Content Filtering Section
 */

import { memo, useState } from 'react'
import { Shield, Plus, X } from 'lucide-react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { Toggle } from '../shared/Toggle'
import type { SectionProps } from '../types'

export const ContentFilteringSection = memo(function ContentFilteringSection({
  draft,
  setDraft,
}: SectionProps) {
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
        title="Content Filtering"
        description="Block ads, trackers, miners, and malicious content on .ton sites"
      />
      <div className="bg-card rounded-xl border border-border px-4">
        <SettingRow
          label="Enable content filtering"
          description="Master toggle for all content filtering categories"
        >
          <Toggle
            checked={draft.contentFilteringEnabled}
            onChange={(v) => setDraft('contentFilteringEnabled', v)}
            label="Enable content filtering"
          />
        </SettingRow>

        {draft.contentFilteringEnabled && (
          <>
            <SettingRow
              label="Block ads"
              description="Block advertisement resources and banners"
            >
              <Toggle
                checked={draft.blockAds}
                onChange={(v) => setDraft('blockAds', v)}
                label="Block ads"
              />
            </SettingRow>

            <SettingRow
              label="Block trackers"
              description="Block tracking scripts, analytics, and pixels"
            >
              <Toggle
                checked={draft.blockTrackers}
                onChange={(v) => setDraft('blockTrackers', v)}
                label="Block trackers"
              />
            </SettingRow>

            <SettingRow
              label="Block miners"
              description="Block cryptocurrency mining scripts"
            >
              <Toggle
                checked={draft.blockMiners}
                onChange={(v) => setDraft('blockMiners', v)}
                label="Block miners"
              />
            </SettingRow>

            <SettingRow
              label="Block malware"
              description="Block malicious scripts and executables"
            >
              <Toggle
                checked={draft.blockMalware}
                onChange={(v) => setDraft('blockMalware', v)}
                label="Block malware"
              />
            </SettingRow>

            <SettingRow
              label="Block annoyances"
              description="Block intrusive overlays and popups"
            >
              <Toggle
                checked={draft.blockAnnoyances}
                onChange={(v) => setDraft('blockAnnoyances', v)}
                label="Block annoyances"
              />
            </SettingRow>

            <SettingRow
              label="Whitelisted domains"
              description="Domains that bypass all content filtering"
            >
              <div className="flex flex-col gap-2 w-full max-w-md">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="example.ton"
                    className="flex-1 px-3 py-1.5 rounded-lg border border-border bg-background text-foreground text-sm"
                  />
                  <button
                    onClick={handleAddDomain}
                    disabled={!newDomain.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    <Plus className="h-4 w-4" />
                    Add
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
