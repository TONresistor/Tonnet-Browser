/**
 * Sidebar de navigation pour les paramètres — carte flottante style iOS / Telegram.
 *
 * Chaque section est une ligne avec une tuile d'icône colorée arrondie (29px, rounded-7),
 * un label et un chevron. Les sections sont regroupées en blocs inset (cartes arrondies),
 * séparées par des hairlines inset (qui démarrent après l'icône). La ligne active est
 * surlignée (layout master-detail).
 */

import { useRef } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SECTIONS } from './constants'
import type { SectionInfo, SettingsSection } from './types'
import { useTranslation } from 'react-i18next'

interface SettingsSidebarProps {
  activeSection: SettingsSection
  onSectionChange: (section: SettingsSection) => void
}

export function SettingsSidebar({ activeSection, onSectionChange }: SettingsSidebarProps) {
  const { t } = useTranslation('settings')
  const navRef = useRef<HTMLDivElement>(null)

  const getSectionLabel = (section: SectionInfo): string => {
    // kebab-case id -> camelCase i18n key (e.g. 'content-filtering' -> 'contentFiltering')
    const key = section.id.replace(/-([a-z])/g, (g) => g[1].toUpperCase())
    return t(`sections.${key}`, { defaultValue: section.label })
  }

  // Bucket the sections into their ordered inset groups.
  const groups: SectionInfo[][] = []
  for (const section of SECTIONS) {
    ;(groups[section.group] ??= []).push(section)
  }
  const groupList = groups.filter((g) => g && g.length > 0)

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = Array.from(navRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
    const focused = document.activeElement as HTMLElement
    const index = items.indexOf(focused)
    if (index === -1) return
    const next = e.key === 'ArrowDown' ? items[index + 1] : items[index - 1]
    next?.focus()
  }

  return (
    <div className="m-3 flex w-[288px] shrink-0 flex-col overflow-hidden rounded-panel border border-border-subtle bg-elevation-1 shadow-panel">
      {/* Header */}
      <div className="px-4 pb-3 pt-4">
        <h2 className="text-[22px] font-bold tracking-tight text-heading">{t('title')}</h2>
      </div>

      {/* Grouped inset list */}
      <div
        ref={navRef}
        role="listbox"
        aria-label={t('title')}
        onKeyDown={handleKeyDown}
        className="flex-1 space-y-5 overflow-y-auto px-3 pb-5"
      >
        {groupList.map((group, gi) => (
          <div key={gi} className="overflow-hidden rounded-group bg-elevation-2">
            {group.map((section, i) => {
              const Icon = section.icon
              const isActive = activeSection === section.id
              return (
                <button
                  key={section.id}
                  role="option"
                  aria-selected={isActive}
                  onClick={() => onSectionChange(section.id)}
                  className={cn(
                    'flex w-full items-center gap-3 pl-3 text-left transition-colors',
                    isActive ? 'bg-[hsl(var(--primary)/0.14)]' : 'hover:bg-surface-hover'
                  )}
                >
                  {/* Colored rounded icon tile */}
                  <span
                    className={cn(
                      'grid h-[29px] w-[29px] shrink-0 place-items-center rounded-control',
                      section.tileClass
                    )}
                  >
                    <Icon className="h-[17px] w-[17px]" />
                  </span>

                  {/* Label + chevron, with an inset hairline above every row but the first */}
                  <span
                    className={cn(
                      'flex h-[50px] min-w-0 flex-1 items-center gap-2 pr-3',
                      i > 0 && 'border-t border-border-subtle'
                    )}
                  >
                    <span className="flex-1 truncate text-[15px] font-medium text-foreground">
                      {getSectionLabel(section)}
                    </span>
                    <ChevronRight className={cn('h-4 w-4 shrink-0', isActive ? 'text-icon/40' : 'text-icon/30')} />
                  </span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
