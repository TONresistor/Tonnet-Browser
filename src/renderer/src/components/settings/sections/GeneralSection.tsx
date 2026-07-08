/**
 * Section paramètres généraux
 */

import { memo } from 'react'
import { Bookmark, Home, HardDrive } from 'lucide-react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { Toggle } from '../shared/Toggle'
import { Segmented } from '@/components/ui/ios/Segmented'
import { SelectInput } from '../shared/SelectInput'
import { OpenPageButton } from '../shared/OpenPageButton'
import { useTabsStore } from '@/stores/tabs'
import { useBookmarksStore } from '@/stores/bookmarks'
import type { SectionProps } from '../types'
import { useTranslation } from 'react-i18next'

export const GeneralSection = memo(function GeneralSection({ draft, setDraft }: SectionProps) {
  const { t } = useTranslation('settings')
  const addTab = useTabsStore((s) => s.addTab)
  const bookmarksCount = useBookmarksStore((s) => s.bookmarks.length)

  return (
    <div>
      <SectionHeader title={t('general.title')} description={t('general.description')} />

      {/* Anonymous Mode */}
      <div className="settings-group px-4">
        <SettingRow label={t('general.anonymousMode')} description={t('general.anonymousModeDesc')}>
          <Toggle
            checked={draft.anonymousMode}
            onChange={(v) => setDraft('anonymousMode', v)}
            ariaLabel={t('general.enableAnonymousMode')}
          />
        </SettingRow>
        {draft.anonymousMode && (
          <SettingRow label={t('general.tunnelMode')} description={t('general.tunnelModeDesc')}>
            <Segmented
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
      <div className="mt-6 settings-group px-4">
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
          <Segmented
            value={draft.homepage}
            onChange={(v) => setDraft('homepage', v)}
            options={[
              { value: 'ton://start', label: t('general.startPage'), icon: <Home className="h-3.5 w-3.5" /> },
              { value: 'ton://storage', label: t('general.tonStorage'), icon: <HardDrive className="h-3.5 w-3.5" /> },
            ]}
          />
        </SettingRow>
        <SettingRow
          label={t('bookmarks.savedBookmarks')}
          description={t('bookmarks.savedBookmarksCount', { count: bookmarksCount })}
        >
          <OpenPageButton
            icon={<Bookmark className="h-4 w-4" />}
            label={t('history.open')}
            onClick={() => addTab('ton://bookmarks')}
          />
        </SettingRow>
      </div>
    </div>
  )
})
