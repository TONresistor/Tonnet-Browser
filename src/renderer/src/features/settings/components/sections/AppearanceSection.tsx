/**
 * Section Appearance
 */

import { memo } from 'react'
import { Columns3, Palette, Rows3 } from 'lucide-react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { Toggle } from '../shared/Toggle'
import { SliderInput } from '../shared/SliderInput'
import { OpenPageButton } from '../shared/OpenPageButton'
import { Segmented } from '@/components/ui/ios/Segmented'
import { useOpenOrSwitchBrowserTab } from '@/features/browser/navigation'
import type { SectionProps } from '../types'
import { useTranslation } from 'react-i18next'

export const AppearanceSection = memo(function AppearanceSection({ draft, setDraft }: SectionProps) {
  const { t } = useTranslation('settings')
  const openOrSwitchToTab = useOpenOrSwitchBrowserTab()

  return (
    <div>
      <SectionHeader title={t('appearance.title')} description={t('appearance.description')} />

      <div className="settings-group px-4">
        <SettingRow label={t('appearance.theme.label')} description={t('appearance.theme.description')}>
          <OpenPageButton
            icon={<Palette className="h-4 w-4" />}
            label={t('themePage.openStudio')}
            onClick={() => openOrSwitchToTab('ton://theme')}
          />
        </SettingRow>
      </div>

      {/* Other appearance settings */}
      <div className="mt-6 settings-group px-4">
        <SettingRow label={t('appearance.zoom.default')} description={t('appearance.zoom.defaultDesc')}>
          <SliderInput
            value={draft.defaultZoom}
            onChange={(v) => setDraft('defaultZoom', v)}
            min={30}
            max={300}
            step={10}
            suffix="%"
          />
        </SettingRow>
        <SettingRow label={t('appearance.zoom.min')} description={t('appearance.zoom.minDesc')}>
          <SliderInput
            value={draft.zoomMin}
            onChange={(v) => setDraft('zoomMin', v)}
            min={10}
            max={100}
            step={10}
            suffix="%"
          />
        </SettingRow>
        <SettingRow label={t('appearance.zoom.max')} description={t('appearance.zoom.maxDesc')}>
          <SliderInput
            value={draft.zoomMax}
            onChange={(v) => setDraft('zoomMax', v)}
            min={100}
            max={500}
            step={10}
            suffix="%"
          />
        </SettingRow>
        <div className="border-t border-border" />
        <SettingRow label={t('appearance.ui.tabOrientation')} description={t('appearance.ui.tabOrientationDesc')}>
          <Segmented
            value={draft.tabOrientation}
            onChange={(v) => setDraft('tabOrientation', v as 'horizontal' | 'vertical')}
            ariaLabel={t('appearance.ui.tabOrientation')}
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
        <SettingRow label={t('appearance.ui.showBookmarksBar')} description={t('appearance.ui.showBookmarksBarDesc')}>
          <Toggle
            checked={draft.showBookmarksBar}
            onChange={(v) => setDraft('showBookmarksBar', v)}
            ariaLabel={t('appearance.ui.showBookmarksBar')}
          />
        </SettingRow>
        <SettingRow label={t('appearance.ui.showStatusBar')} description={t('appearance.ui.showStatusBarDesc')}>
          <Toggle
            checked={draft.showStatusBar}
            onChange={(v) => setDraft('showStatusBar', v)}
            ariaLabel={t('appearance.ui.showStatusBar')}
          />
        </SettingRow>
      </div>
    </div>
  )
})
