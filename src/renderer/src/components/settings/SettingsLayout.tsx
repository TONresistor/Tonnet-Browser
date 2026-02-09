/**
 * Layout wrapper pour la page Settings
 */

import type { ReactNode } from 'react'

interface SettingsLayoutProps {
  sidebar: ReactNode
  content: ReactNode
  actions?: ReactNode
}

export function SettingsLayout({ sidebar, content, actions }: SettingsLayoutProps) {
  return (
    <div className="flex h-full bg-background-secondary flex-col" style={{ fontFamily: 'Inter, sans-serif' }}>
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        {sidebar}

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-2xl mx-auto">{content}</div>
        </div>
      </div>

      {/* Actions (save bar) */}
      {actions}
    </div>
  )
}
