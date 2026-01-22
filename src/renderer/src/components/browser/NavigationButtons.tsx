/**
 * Browser navigation buttons.
 * Back, forward, reload, home, and stop.
 */

import { ArrowLeft, ArrowRight, RotateCw, Home, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSettingsStore } from '@/stores/settings'
import { useTabsStore } from '@/stores/tabs'
import { useTranslation } from 'react-i18next'

export function NavigationButtons() {
  const { t } = useTranslation('browser')
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
      aria-label={t('navigation.pageNavigation')}
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={handleBack}
        disabled={!canGoBack}
        className="h-7 w-7 rounded-full"
        title={t('navigation.back')}
        aria-label={t('navigation.goBackAria')}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        onClick={handleForward}
        disabled={!canGoForward}
        className="h-7 w-7 rounded-full"
        title={t('navigation.forward')}
        aria-label={t('navigation.goForwardAria')}
      >
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        onClick={handleReload}
        className="h-7 w-7 rounded-full"
        title={isLoading ? t('navigation.stop') : t('navigation.reload')}
        aria-label={isLoading ? t('navigation.stopLoadingAria') : t('navigation.reloadAria')}
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
        title={t('navigation.home')}
        aria-label={t('navigation.goHomeAria')}
      >
        <Home className="h-4 w-4" aria-hidden="true" />
      </Button>
    </nav>
  )
}
