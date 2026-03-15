/**
 * Section À propos
 */

import { memo, useState, useEffect, useCallback, useRef } from 'react'
import { ExternalLink, CircleCheckBig, Download, RefreshCw, LoaderCircle, CircleAlert } from 'lucide-react'
import { SectionHeader } from '../shared/SectionHeader'
import { APP_NAME, APP_VERSION } from '@shared/constants'
import tonLogo from '@/assets/ton.png'
import { useTranslation } from 'react-i18next'

type UpdateState = 'idle' | 'checking' | 'available' | 'up-to-date' | 'downloading' | 'ready' | 'error'

export const AboutSection = memo(function AboutSection() {
  const { t } = useTranslation('settings')
  const [updateState, setUpdateState] = useState<UpdateState>('idle')
  const [newVersion, setNewVersion] = useState('')
  const [downloadPercent, setDownloadPercent] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const upToDateTimer = useRef<ReturnType<typeof setTimeout>>(null)

  useEffect(() => {
    const unsubs: (() => void)[] = []

    unsubs.push(
      window.electron.on('updater:available', (info: unknown) => {
        const { version } = info as { version: string }
        setNewVersion(version)
        setUpdateState('available')
      })
    )

    unsubs.push(
      window.electron.on('updater:not-available', () => {
        setUpdateState('up-to-date')
        upToDateTimer.current = setTimeout(() => setUpdateState('idle'), 3000)
      })
    )

    unsubs.push(
      window.electron.on('updater:progress', (progress: unknown) => {
        const { percent } = progress as { percent: number }
        setDownloadPercent(Math.round(percent))
      })
    )

    unsubs.push(
      window.electron.on('updater:downloaded', () => {
        setUpdateState('ready')
      })
    )

    unsubs.push(
      window.electron.on('updater:error', (message: unknown) => {
        setErrorMessage(String(message))
        setUpdateState('error')
      })
    )

    return () => {
      unsubs.forEach((fn) => fn())
      if (upToDateTimer.current) clearTimeout(upToDateTimer.current)
    }
  }, [])

  const handleCheck = useCallback(async () => {
    setUpdateState('checking')
    setErrorMessage('')
    try {
      const result = await window.electron.updater.check()
      // In dev mode, electron-updater can't check — events won't fire
      if (result?.reason === 'dev-mode') {
        setUpdateState('up-to-date')
        upToDateTimer.current = setTimeout(() => setUpdateState('idle'), 3000)
      }
      // Otherwise, state will be set by event listeners
    } catch {
      setErrorMessage(t('about.update.errorGeneric'))
      setUpdateState('error')
    }
  }, [t])

  const handleDownload = useCallback(async () => {
    setUpdateState('downloading')
    setDownloadPercent(0)
    try {
      await window.electron.updater.download()
    } catch {
      setErrorMessage(t('about.update.errorDownload'))
      setUpdateState('error')
    }
  }, [t])

  const handleInstall = useCallback(() => {
    window.electron.updater.install()
  }, [])

  const renderUpdateButton = () => {
    switch (updateState) {
      case 'idle':
        return (
          <button
            onClick={handleCheck}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 bg-primary/15 border border-primary/30 text-primary hover:bg-primary/25"
          >
            <RefreshCw className="h-4 w-4" />
            {t('about.update.check')}
          </button>
        )

      case 'checking':
        return (
          <button
            disabled
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 bg-primary/15 border border-primary/30 text-primary opacity-70"
          >
            <LoaderCircle className="h-4 w-4 animate-spin" />
            {t('about.update.checking')}
          </button>
        )

      case 'up-to-date':
        return (
          <button
            disabled
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 bg-green-500/15 border border-green-500/30 text-green-400"
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
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 bg-primary/90 text-white shadow-[0_4px_16px_var(--primary-glow)] hover:bg-primary"
            >
              <Download className="h-4 w-4" />
              {t('about.update.download')}
            </button>
          </div>
        )

      case 'downloading':
        return (
          <button
            disabled
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 bg-primary/15 border border-primary/30 text-primary opacity-70"
          >
            <LoaderCircle className="h-4 w-4 animate-spin" />
            {t('about.update.downloading')} {downloadPercent}%
          </button>
        )

      case 'ready':
        return (
          <button
            onClick={handleInstall}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 bg-green-500/90 text-white shadow-[0_4px_16px_rgba(34,197,94,0.3)] hover:bg-green-500"
          >
            <RefreshCw className="h-4 w-4" />
            {t('about.update.restart')}
          </button>
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
      <div className="bg-card rounded-xl border border-border p-6 text-center">
        <div className="w-16 h-16 mx-auto mb-4">
          <img src={tonLogo} alt="TON" className="w-full h-full object-contain" />
        </div>
        <h3 className="text-2xl font-bold text-foreground mb-1">{APP_NAME}</h3>
        <p className="text-muted-foreground mb-4">Version {APP_VERSION}</p>
        <p className="text-muted-foreground text-sm max-w-md mx-auto">{t('about.description')}</p>

        <div className="mt-4 flex justify-center">{renderUpdateButton()}</div>

        <div className="mt-6 pt-6 border-t border-border">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">{t('about.electron')}</p>
              <p className="text-foreground font-mono">{window.electron?.versions?.electron || 'N/A'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t('about.chromium')}</p>
              <p className="text-foreground font-mono">{window.electron?.versions?.chrome || 'N/A'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t('about.nodejs')}</p>
              <p className="text-foreground font-mono">{window.electron?.versions?.node || 'N/A'}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex gap-3">
        <button
          className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium text-muted-foreground transition-all duration-200 hover:text-foreground bg-surface-hover border border-border-medium"
          onClick={() => window.electron.navigate('http://github.com/example/ton-browser')}
        >
          <ExternalLink className="h-4 w-4" />
          {t('about.github')}
        </button>
      </div>
    </div>
  )
})
