/**
 * Section Bookmarks - simple link to ton://bookmarks
 */

import { memo } from 'react'
import { Bookmark } from 'lucide-react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { OpenPageButton } from '../shared/OpenPageButton'
import { useTabsStore } from '@/stores/tabs'
import { useBookmarksStore } from '@/stores/bookmarks'
import { useTranslation } from 'react-i18next'

export const BookmarksSection = memo(function BookmarksSection() {
  const { t } = useTranslation('settings')
  const addTab = useTabsStore((s) => s.addTab)
  const bookmarksCount = useBookmarksStore((s) => s.bookmarks.length)

  return (
    <div>
      <SectionHeader title={t('bookmarks.title')} description={t('bookmarks.description')} />
      <div className="settings-group px-4">
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
