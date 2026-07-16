/**
 * Section À propos
 */

import { memo, useState, useEffect, useCallback, useRef } from 'react'
import { aboutClient } from '@/features/about/client'
import { CircleCheckBig, Download, RefreshCw, LoaderCircle, CircleAlert } from 'lucide-react'
import { SectionHeader } from '../shared/SectionHeader'
import { APP_NAME, APP_VERSION, UI_NOTIFICATION_TIMEOUT_MS } from '@shared/constants'
import tonLogo from '@/assets/ton.png'
import { useTranslation } from 'react-i18next'

type UpdateState = 'idle' | 'checking' | 'available' | 'up-to-date' | 'error'

export const AboutSection = memo(function AboutSection() {
  const { t } = useTranslation('settings')
  const [updateState, setUpdateState] = useState<UpdateState>('idle')
  const [newVersion, setNewVersion] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const upToDateTimer = useRef<ReturnType<typeof setTimeout>>(null)

  useEffect(() => {
    return () => {
      if (upToDateTimer.current) clearTimeout(upToDateTimer.current)
    }
  }, [])

  const handleCheck = useCallback(async () => {
    setUpdateState('checking')
    setErrorMessage('')
    try {
      const result = await aboutClient.checkForUpdates()
      if (result.updateAvailable && result.version) {
        setNewVersion(result.version)
        setUpdateState('available')
      } else {
        setUpdateState('up-to-date')
        upToDateTimer.current = setTimeout(() => setUpdateState('idle'), UI_NOTIFICATION_TIMEOUT_MS)
      }
    } catch {
      setErrorMessage(t('about.update.errorGeneric'))
      setUpdateState('error')
    }
  }, [t])

  const handleOpenDownloadPage = useCallback(async () => {
    try {
      await aboutClient.openDownloadPage()
    } catch {
      // Silent failure — user will still see the Download button if they want to retry
    }
    setUpdateState('idle')
  }, [])

  const renderUpdateButton = () => {
    switch (updateState) {
      case 'idle':
        return (
          <button
            onClick={handleCheck}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-colors bg-primary text-primary-foreground shadow-none hover:bg-primary/90"
          >
            <RefreshCw className="h-4 w-4" />
            {t('about.update.check')}
          </button>
        )

      case 'checking':
        return (
          <button
            disabled
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-colors bg-primary text-primary-foreground opacity-70 shadow-none"
          >
            <LoaderCircle className="h-4 w-4 animate-spin" />
            {t('about.update.checking')}
          </button>
        )

      case 'up-to-date':
        return (
          <button
            disabled
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 bg-success/15 border border-success/30 text-success"
          >
            <CircleCheckBig className="h-4 w-4" />
            {t('about.update.upToDate')}
          </button>
        )

      case 'available':
        return (
          <div className="flex items-center gap-3">
            <span className="text-sm text-primary font-medium">
              v{newVersion} {t('about.update.available')}
            </span>
            <button
              onClick={handleOpenDownloadPage}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 bg-primary/90 text-primary-foreground shadow-[0_4px_16px_var(--primary-glow)] hover:bg-primary"
            >
              <Download className="h-4 w-4" />
              {t('about.update.download')}
            </button>
          </div>
        )

      case 'error':
        return (
          <div className="flex items-center gap-3">
            <span className="text-sm text-destructive flex items-center gap-1">
              <CircleAlert className="h-3.5 w-3.5" />
              {errorMessage || t('about.update.errorGeneric')}
            </span>
            <button
              onClick={handleCheck}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all duration-200 bg-surface-hover border border-border-medium text-muted-foreground hover:text-foreground"
            >
              {t('about.update.retry')}
            </button>
          </div>
        )
    }
  }

  return (
    <div>
      <SectionHeader title={t('about.title')} />
      <div className="settings-group p-6 text-center">
        <div className="w-16 h-16 mx-auto mb-4">
          <img src={tonLogo} alt="TON" className="w-full h-full object-contain" />
        </div>
        <h3 className="text-2xl font-bold text-heading mb-1">{APP_NAME}</h3>
        <p className="text-muted-foreground mb-4">{t('about.version', { version: APP_VERSION })}</p>
        <p className="text-muted-foreground text-sm max-w-md mx-auto">{t('about.description')}</p>

        <div className="mt-4 flex justify-center">{renderUpdateButton()}</div>

        <div className="mt-6 pt-6 border-t border-border">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">{t('about.electron')}</p>
              <p className="text-foreground font-mono">{aboutClient.versions()?.electron || 'N/A'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t('about.chromium')}</p>
              <p className="text-foreground font-mono">{aboutClient.versions()?.chrome || 'N/A'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t('about.nodejs')}</p>
              <p className="text-foreground font-mono">{aboutClient.versions()?.node || 'N/A'}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})
