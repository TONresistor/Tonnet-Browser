/**
 * Section paramètres généraux
 */

import { memo } from 'react'
import { Home, HardDrive, Rows3, Columns3 } from 'lucide-react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { Toggle } from '../shared/Toggle'
import { ToggleGroup } from '../shared/ToggleGroup'
import { SelectInput } from '../shared/SelectInput'
import type { SectionProps } from '../types'
import { useTranslation } from 'react-i18next'

export const GeneralSection = memo(function GeneralSection({ draft, setDraft }: SectionProps) {
  const { t } = useTranslation('settings')

  return (
    <div>
      <SectionHeader title={t('general.title')} description={t('general.description')} />

      {/* Anonymous Mode */}
      <div className="glass-card px-4">
        <SettingRow label={t('general.anonymousMode')} description={t('general.anonymousModeDesc')}>
          <Toggle
            checked={draft.anonymousMode}
            onChange={(v) => setDraft('anonymousMode', v)}
            label={t('general.enableAnonymousMode')}
          />
        </SettingRow>
        {draft.anonymousMode && (
          <SettingRow label={t('general.tunnelMode')} description={t('general.tunnelModeDesc')}>
            <ToggleGroup
              value={draft.tunnelMode}
              onChange={(v) => setDraft('tunnelMode', v)}
              options={[
                { value: 'standard', label: t('general.tunnelStandard') },
                { value: 'maximum', label: t('general.tunnelMaximum') },
              ]}
            />
          </SettingRow>
        )}
      </div>

      {/* Settings */}
      <div className="mt-6 glass-card px-4">
        <SettingRow label={t('network.autoConnect')} description={t('network.autoConnectDesc')}>
          <Toggle
            checked={draft.autoConnect}
            onChange={(v) => setDraft('autoConnect', v)}
            label={t('network.autoConnectLabel')}
          />
        </SettingRow>
        <SettingRow label={t('appearance.language.label')} description={t('appearance.language.description')}>
          <SelectInput
            value={draft.language}
            onChange={(v) => setDraft('language', v)}
            options={[
              { value: 'en', label: t('appearance.language.english') },
              { value: 'ru', label: t('appearance.language.russian') },
              { value: 'zh', label: t('appearance.language.chinese') },
              { value: 'es', label: t('appearance.language.spanish') },
              { value: 'id', label: t('appearance.language.indonesian') },
              { value: 'th', label: t('appearance.language.thai') },
              { value: 'de', label: t('appearance.language.german') },
              { value: 'fr', label: t('appearance.language.french') },
              { value: 'pt', label: t('appearance.language.portuguese') },
              { value: 'ko', label: t('appearance.language.korean') },
            ]}
          />
        </SettingRow>
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
        <SettingRow label={t('appearance.ui.tabOrientation')} description={t('appearance.ui.tabOrientationDesc')}>
          <ToggleGroup
            value={draft.tabOrientation}
            onChange={(v) => setDraft('tabOrientation', v as 'horizontal' | 'vertical')}
            options={[
              {
                value: 'horizontal',
                label: t('appearance.ui.tabOrientationHorizontal'),
                icon: <Columns3 className="h-3.5 w-3.5" />,
              },
              {
                value: 'vertical',
                label: t('appearance.ui.tabOrientationVertical'),
                icon: <Rows3 className="h-3.5 w-3.5" />,
              },
            ]}
          />
        </SettingRow>
        <SettingRow label={t('privacy.clearOnExit')} description={t('privacy.clearOnExitDesc')}>
          <Toggle
            checked={draft.clearOnExit}
            onChange={(v) => setDraft('clearOnExit', v)}
            label={t('privacy.clearOnExitLabel')}
          />
        </SettingRow>
      </div>
    </div>
  )
})
