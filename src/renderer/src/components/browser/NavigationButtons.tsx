/**
 * Browser navigation buttons.
 * Back, forward, reload, home, and stop.
 */

import { ArrowLeft, ArrowRight, RotateCw, Home, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSettingsStore } from '@/stores/settings'
import { useTabsStore } from '@/stores/tabs'

export function NavigationButtons() {
  const { canGoBack, canGoForward, isLoading } = useSettingsStore()
  const { navigateActiveTab, goBack, goForward } = useTabsStore()

  const handleBack = () => {
    goBack()
  }

  const handleForward = () => {
    goForward()
  }

  const handleReload = () => {
    if (isLoading) {
      window.electron.stop()
    } else {
      window.electron.reload()
    }
  }

  const handleHome = () => {
    navigateActiveTab('ton://start')
  }

  return (
    <nav
      className="flex items-center gap-0.5 rounded-full px-1 py-0.5 bg-surface border border-surface-hover backdrop-blur-[20px]"
      aria-label="Page navigation"
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={handleBack}
        disabled={!canGoBack}
        className="h-7 w-7 rounded-full"
        title="Back"
        aria-label="Go back to previous page"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        onClick={handleForward}
        disabled={!canGoForward}
        className="h-7 w-7 rounded-full"
        title="Forward"
        aria-label="Go forward to next page"
      >
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        onClick={handleReload}
        className="h-7 w-7 rounded-full"
        title={isLoading ? 'Stop' : 'Reload'}
        aria-label={isLoading ? 'Stop loading page' : 'Reload current page'}
      >
        {isLoading ? (
          <X className="h-4 w-4" aria-hidden="true" />
        ) : (
          <RotateCw className="h-4 w-4" aria-hidden="true" />
        )}
      </Button>

      <Button
        variant="ghost"
        size="icon"
        onClick={handleHome}
        className="h-7 w-7 rounded-full"
        title="Home"
        aria-label="Go to homepage"
      >
        <Home className="h-4 w-4" aria-hidden="true" />
      </Button>
    </nav>
  )
}
