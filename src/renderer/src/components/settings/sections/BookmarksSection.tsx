/**
 * Section Bookmarks - simple link to ton://bookmarks
 */

import { memo } from 'react'
import { Bookmark } from 'lucide-react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
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
      <div className="glass-card px-4">
        <SettingRow
          label={t('bookmarks.savedBookmarks')}
          description={`${bookmarksCount} ${t('bookmarks.savedBookmarks').toLowerCase()}`}
        >
          <button
            onClick={() => addTab('ton://bookmarks')}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 bg-surface-hover border border-border-medium text-foreground hover:bg-surface-active"
          >
            <Bookmark className="h-4 w-4" />
            {t('history.open')}
          </button>
        </SettingRow>
      </div>
    </div>
  )
})
