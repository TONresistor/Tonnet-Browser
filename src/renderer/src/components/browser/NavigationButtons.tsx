/**
 * Browser navigation buttons.
 * Back, forward, reload, home, and stop.
 */

import { ArrowLeft, ArrowRight, RotateCw, X } from 'lucide-react'
import { browserClient } from '@/features/browser/client'
import { Button } from '@/components/ui/button'
import homeIconSrc from '@/assets/home.svg'
import { useBrowserStore } from '@/stores/browser'
import { useTabsStore } from '@/stores/tabs'
import { useTranslation } from 'react-i18next'

export function NavigationButtons() {
  const { t } = useTranslation('browser')
  const canGoBack = useBrowserStore((s) => s.canGoBack)
  const canGoForward = useBrowserStore((s) => s.canGoForward)
  const isLoading = useBrowserStore((s) => s.isLoading)
  const navigateActiveTab = useTabsStore((s) => s.navigateActiveTab)
  const goBack = useTabsStore((s) => s.goBack)
  const goForward = useTabsStore((s) => s.goForward)

  const handleBack = () => {
    goBack()
  }

  const handleForward = () => {
    goForward()
  }

  const handleReload = () => {
    if (isLoading) {
      browserClient.stop()
    } else {
      browserClient.reload()
    }
  }

  const handleHome = () => {
    navigateActiveTab('ton://start')
  }

  return (
    <nav
      className="flex items-center gap-0.5 rounded-full px-1 py-0.5 glass-surface"
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
        {isLoading ? <X className="h-4 w-4" aria-hidden="true" /> : <RotateCw className="h-4 w-4" aria-hidden="true" />}
      </Button>

      <Button
        variant="ghost"
        size="icon"
        onClick={handleHome}
        className="h-7 w-7 rounded-full"
        title={t('navigation.home')}
        aria-label={t('navigation.goHomeAria')}
      >
        <img
          src={homeIconSrc}
          alt=""
          className="h-4 w-4 text-foreground"
          style={{ filter: 'brightness(0) invert(1)' }}
          aria-hidden="true"
        />
      </Button>
    </nav>
  )
}
