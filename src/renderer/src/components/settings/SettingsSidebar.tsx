/**
 * Sidebar de navigation pour les paramètres
 */

import { useRef } from 'react'
import { Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SECTIONS } from './constants'
import type { SettingsSection } from './types'
import { useTranslation } from 'react-i18next'

interface SettingsSidebarProps {
  activeSection: SettingsSection
  onSectionChange: (section: SettingsSection) => void
}

export function SettingsSidebar({ activeSection, onSectionChange }: SettingsSidebarProps) {
  const { t } = useTranslation('settings')
  const navRef = useRef<HTMLElement>(null)

  const getSectionLabel = (sectionId: string): string => {
    // Convert kebab-case to camelCase (e.g. 'content-filtering' -> 'contentFiltering')
    const sectionKey = sectionId.replace(/-([a-z])/g, (g) => g[1].toUpperCase())
    return t(`sections.${sectionKey}`)
  }

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
    <div className="w-56 border-r border-border p-4 flex flex-col bg-[hsl(var(--elevation-1))]">
      <div className="flex items-center justify-center gap-2 mb-4">
        <Settings className="h-5 w-5 text-primary" />
        <h2 className="text-foreground text-xl font-bold">{t('title')}</h2>
      </div>

      <nav ref={navRef} role="listbox" onKeyDown={handleKeyDown} className="space-y-2">
        {SECTIONS.map((section) => {
          const Icon = section.icon
          const isActive = activeSection === section.id
          return (
            <button
              key={section.id}
              role="option"
              aria-selected={isActive}
              onClick={() => onSectionChange(section.id)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                isActive
                  ? 'bg-accent/60 text-foreground'
                  : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
              )}
            >
              <Icon className={cn('h-4 w-4', !isActive && 'opacity-70')} />
              <span>{getSectionLabel(section.id)}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
