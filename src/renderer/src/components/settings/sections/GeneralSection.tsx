/**
 * Section paramètres généraux
 */

import { memo } from 'react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { Toggle } from '../shared/Toggle'
import { SelectInput } from '../shared/SelectInput'
import { GarlicRoutingDiagram } from '../shared/GarlicRoutingDiagram'
import type { SectionProps } from '../types'
import { useTranslation } from 'react-i18next'

export const GeneralSection = memo(function GeneralSection({ draft, setDraft }: SectionProps) {
  const { t } = useTranslation('settings')

  return (
    <div>
      <SectionHeader title={t('general.title')} description={t('general.description')} />

      {/* Anonymous Mode Section */}
      <div className="bg-card rounded-xl border border-border px-4">
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

        {/* Circuit rotation - visible when anonymous mode is ON */}
        {draft.anonymousMode && (
          <>
            <div className="py-4 border-b border-border">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-foreground font-medium">{t('general.circuitRotation')}</p>
                  <p className="text-muted-foreground text-sm mt-0.5">{t('general.circuitRotationDesc')}</p>
                </div>
                <Toggle
                  checked={draft.circuitRotation}
                  onChange={(v) => setDraft('circuitRotation', v)}
                  label={t('general.enableCircuitRotation')}
                />
              </div>
            </div>

            {draft.circuitRotation && (
              <div className="ml-4 pl-4 border-l-2 border-border">
                <div className="py-4 border-b border-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-foreground font-medium">{t('general.rotationInterval')}</p>
                      <p className="text-muted-foreground text-sm mt-0.5">{t('general.rotationIntervalDesc')}</p>
                    </div>
                    <select
                      value={draft.rotateInterval}
                      onChange={(e) => setDraft('rotateInterval', e.target.value)}
                      className="pl-4 pr-8 py-1.5 rounded-full text-sm text-foreground outline-none cursor-pointer bg-surface-hover border border-border-medium"
                    >
                      <option value="5m" className="bg-background text-foreground">
                        {t('general.5minutes')}
                      </option>
                      <option value="10m" className="bg-background text-foreground">
                        {t('general.10minutes')}
                      </option>
                      <option value="15m" className="bg-background text-foreground">
                        {t('general.15minutes')}
                      </option>
                      <option value="30m" className="bg-background text-foreground">
                        {t('general.30minutes')}
                      </option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* How it works - Garlic Routing Diagram */}
        <GarlicRoutingDiagram />
      </div>

      {/* Other General Settings */}
      <div className="mt-6 bg-card rounded-xl border border-border px-4">
        <SettingRow label={t('general.homepage')} description={t('general.homepageDesc')}>
          <SelectInput
            value={draft.homepage}
            onChange={(v) => setDraft('homepage', v)}
            options={[
              { value: 'ton://start', label: t('general.startPage') },
              { value: 'ton://storage', label: t('general.tonStorage') },
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
