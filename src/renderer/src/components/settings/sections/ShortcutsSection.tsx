/**
 * Section des raccourcis clavier
 */

import { memo } from 'react'
import { SectionHeader } from '../shared/SectionHeader'
import { SHORTCUTS } from '../constants'

export const ShortcutsSection = memo(function ShortcutsSection() {
  return (
    <div>
      <SectionHeader
        title="Keyboard Shortcuts"
        description="Quick actions for power users"
      />
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase tracking-wider font-medium">
                Action
              </th>
              <th className="px-4 py-3 text-right text-xs text-muted-foreground uppercase tracking-wider font-medium">
                Shortcut
              </th>
            </tr>
          </thead>
          <tbody>
            {SHORTCUTS.map((item, idx) => (
              <tr
                key={item.action}
                className={idx !== SHORTCUTS.length - 1 ? 'border-b border-border/50' : ''}
              >
                <td className="px-4 py-3 text-foreground text-sm">{item.action}</td>
                <td className="px-4 py-3 text-right">
                  <kbd className="px-2 py-1 bg-background-secondary rounded text-primary text-xs font-mono">
                    {item.shortcut}
                  </kbd>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
})
