/**
 * Window control buttons.
 * Minimize, maximize, and close.
 */

import { Minus, Square, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function WindowControls() {
  const { t } = useTranslation('browser')

  const handleMinimize = () => {
    window.electron.window.minimize()
  }

  const handleMaximize = () => {
    window.electron.window.maximize()
  }

  const handleClose = () => {
    window.electron.window.close()
  }

  return (
    <div className="flex items-center no-drag" role="group" aria-label={t('windowControls.group')}>
      <button
        className="h-8 w-10 flex items-center justify-center hover:bg-border transition-colors"
        onClick={handleMinimize}
        title={t('windowControls.minimize')}
        aria-label={t('windowControls.minimize')}
      >
        <Minus className="h-4 w-4" aria-hidden="true" />
      </button>

      <button
        className="h-8 w-10 flex items-center justify-center hover:bg-border transition-colors"
        onClick={handleMaximize}
        title={t('windowControls.maximize')}
        aria-label={t('windowControls.maximize')}
      >
        <Square className="h-3 w-3" aria-hidden="true" />
      </button>

      <button
        className="h-8 w-10 flex items-center justify-center hover:bg-destructive transition-colors"
        onClick={handleClose}
        title={t('windowControls.close')}
        aria-label={t('windowControls.close')}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}
