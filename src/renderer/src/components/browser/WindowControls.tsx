/**
 * Window control buttons.
 * Minimize, maximize, and close.
 */

import { Minus, Square, X } from 'lucide-react'

export function WindowControls() {
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
    <div className="flex items-center no-drag" role="group" aria-label="Window controls">
      <button
        className="h-8 w-10 flex items-center justify-center hover:bg-border transition-colors"
        onClick={handleMinimize}
        title="Minimize"
        aria-label="Minimize window"
      >
        <Minus className="h-4 w-4" aria-hidden="true" />
      </button>

      <button
        className="h-8 w-10 flex items-center justify-center hover:bg-border transition-colors"
        onClick={handleMaximize}
        title="Maximize"
        aria-label="Maximize window"
      >
        <Square className="h-3 w-3" aria-hidden="true" />
      </button>

      <button
        className="h-8 w-10 flex items-center justify-center hover:bg-destructive transition-colors"
        onClick={handleClose}
        title="Close"
        aria-label="Close window"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}
