/**
 * Section des raccourcis clavier
 */

import { memo } from 'react'
import { SectionHeader } from '../shared/SectionHeader'
import { SHORTCUTS } from '../constants'
import { useTranslation } from 'react-i18next'

export const ShortcutsSection = memo(function ShortcutsSection() {
  const { t } = useTranslation('settings')

  // Map action labels to translation keys
  const actionKeyMap: Record<string, string> = {
    'New tab': 'newTab',
    'Close tab': 'closeTab',
    'Reopen closed tab': 'reopenClosedTab',
    'Next tab': 'nextTab',
    'Previous tab': 'previousTab',
    'Go to tab 1-9': 'goToTab',
    History: 'history',
    'Focus address bar': 'focusAddressBar',
    Reload: 'reload',
    Back: 'back',
    Forward: 'forward',
    'Stop loading': 'stopLoading',
    'Zoom in': 'zoomIn',
    'Zoom out': 'zoomOut',
    'Reset zoom': 'resetZoom',
    'Developer tools': 'devTools',
  }

  return (
    <div>
      <SectionHeader title={t('shortcuts.title')} description={t('shortcuts.description')} />
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase tracking-wider font-medium">
                {t('shortcuts.action')}
              </th>
              <th className="px-4 py-3 text-right text-xs text-muted-foreground uppercase tracking-wider font-medium">
                {t('shortcuts.shortcut')}
              </th>
            </tr>
          </thead>
          <tbody>
            {SHORTCUTS.map((item, idx) => (
              <tr key={item.action} className={idx !== SHORTCUTS.length - 1 ? 'border-b border-border/50' : ''}>
                <td className="px-4 py-3 text-foreground text-sm">
                  {t(`shortcuts.actions.${actionKeyMap[item.action] || item.action}`)}
                </td>
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
