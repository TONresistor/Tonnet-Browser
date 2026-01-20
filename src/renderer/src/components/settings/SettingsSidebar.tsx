/**
 * Sidebar de navigation pour les paramètres
 */

import { Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SECTIONS } from './constants'
import type { SettingsSection } from './types'

interface SettingsSidebarProps {
  activeSection: SettingsSection
  onSectionChange: (section: SettingsSection) => void
}

export function SettingsSidebar({ activeSection, onSectionChange }: SettingsSidebarProps) {
  return (
    <div className="w-56 border-r border-border p-4 flex flex-col">
      <div className="flex items-center gap-2 mb-6">
        <Settings className="h-6 w-6 text-primary" />
        <h2 className="text-foreground text-xl font-bold">Settings</h2>
      </div>

      <nav className="space-y-2">
        {SECTIONS.map((section) => {
          const Icon = section.icon
          const isActive = activeSection === section.id
          return (
            <button
              key={section.id}
              onClick={() => onSectionChange(section.id)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-full text-sm transition-all duration-200 backdrop-blur-md border',
                isActive
                  ? 'bg-surface-active border-border-strong text-foreground'
                  : 'bg-surface/50 border-border hover:bg-surface-hover'
              )}
            >
              <Icon className={cn('h-4 w-4', !isActive && 'text-muted-foreground')} />
              <span className={!isActive ? 'text-muted-foreground' : ''}>{section.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
