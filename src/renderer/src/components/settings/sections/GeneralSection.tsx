/**
 * Section paramètres généraux
 */

import { memo, useState } from 'react'
import { Home, HardDrive, ChevronDown } from 'lucide-react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { Toggle } from '../shared/Toggle'
import { ToggleGroup } from '../shared/ToggleGroup'
import { GarlicRoutingDiagram } from '../shared/GarlicRoutingDiagram'
import type { SectionProps } from '../types'
import { useTranslation } from 'react-i18next'

export const GeneralSection = memo(function GeneralSection({ draft, setDraft }: SectionProps) {
  const { t } = useTranslation('settings')
  const [howItWorksOpen, setHowItWorksOpen] = useState(false)

  return (
    <div>
      <SectionHeader title={t('general.title')} description={t('general.description')} />

      {/* Anonymous Mode Section */}
      <div className="glass-card px-4">
        {/* Anonymous mode toggle */}
        <div className="py-4 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex-1 pr-4">
              <p className="text-foreground font-medium">{t('general.anonymousMode')}</p>
              <p className="text-muted-foreground text-sm mt-0.5">{t('general.anonymousModeDesc')}</p>
            </div>
            <Toggle
              checked={draft.anonymousMode}
              onChange={(v) => setDraft('anonymousMode', v)}
              label={t('general.enableAnonymousMode')}
            />
          </div>
        </div>

        {/* How it works - Garlic Routing Diagram (collapsible) */}
        <div className="border-t border-border">
          <button
            type="button"
            onClick={() => setHowItWorksOpen(!howItWorksOpen)}
            className="flex items-center justify-between w-full py-4 text-left"
          >
            <p className="text-foreground font-medium">{t('general.howItWorks')}</p>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${howItWorksOpen ? 'rotate-180' : ''}`}
            />
          </button>
          {howItWorksOpen && <GarlicRoutingDiagram />}
        </div>
      </div>

      {/* Other General Settings */}
      <div className="mt-6 glass-card px-4">
        <SettingRow label={t('general.homepage')} description={t('general.homepageDesc')}>
          <ToggleGroup
            value={draft.homepage}
            onChange={(v) => setDraft('homepage', v)}
            options={[
              { value: 'ton://start', label: t('general.startPage'), icon: <Home className="h-3.5 w-3.5" /> },
              { value: 'ton://storage', label: t('general.tonStorage'), icon: <HardDrive className="h-3.5 w-3.5" /> },
            ]}
          />
        </SettingRow>
        <SettingRow label={t('general.restoreTabs')} description={t('general.restoreTabsDesc')}>
          <Toggle
            checked={draft.restoreTabs}
            onChange={(v) => setDraft('restoreTabs', v)}
            label={t('general.restoreTabsLabel')}
          />
        </SettingRow>
      </div>
    </div>
  )
})
