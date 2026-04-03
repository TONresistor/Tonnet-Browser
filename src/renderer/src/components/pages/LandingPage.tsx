/**
 * Landing page - initial connection screen.
 * Shows connect button and loading animation.
 */

import { useState, useEffect } from 'react'
import { useProxy } from '@/hooks/useProxy'
import Lottie from 'lottie-react'
import welcomeAnimation from '@/assets/welcome.json'
import welcomeYellowAnimation from '@/assets/welcome-yellow.json'
import loadingAnimation from '@/assets/loading.json'
import loadingYellowAnimation from '@/assets/loading-yellow.json'
import { APP_VERSION } from '@shared/constants'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { usePreferences } from '@/stores/preferences'
import { useTranslation } from 'react-i18next'

export function LandingPage() {
  const { t } = useTranslation('landing')
  const { isConnecting, error, connect } = useProxy()
  const [autoConnecting, setAutoConnecting] = useState(false)
  const [currentStep, setCurrentStep] = useState(-1)
  const [stepMessage, setStepMessage] = useState('')
  const { theme } = usePreferences()
  const isYellow = theme === 'utya-duck'

  const CONNECTION_STEPS = [
    t('connectionSteps.startingProxy'),
    t('connectionSteps.loadingConfig'),
    t('connectionSteps.syncingDHT'),
    t('connectionSteps.connectingNetwork'),
    t('connectionSteps.ready'),
  ]

  const currentWelcomeAnimation = isYellow ? welcomeYellowAnimation : welcomeAnimation
  const currentLoadingAnimation = isYellow ? loadingYellowAnimation : loadingAnimation

  // Listen for proxy progress events and auto-connect trigger
  useEffect(() => {
    const unsubProgress = window.electron.on(IPC_CHANNELS.PROXY_PROGRESS, (...args: unknown[]) => {
      const data = args[0] as { step: number; message: string }
      setCurrentStep(data.step)
      setStepMessage(data.message)
    })

    // Auto-connect triggers the same loading state as manual connect
    const unsubAutoConnect = window.electron.on('proxy:auto-connect', () => {
      setAutoConnecting(true)
    })

    return () => {
      unsubProgress()
      unsubAutoConnect()
    }
  }, [])

  const showLoading = isConnecting || autoConnecting

  // Reset step when not connecting
  useEffect(() => {
    if (!showLoading) {
      setCurrentStep(-1)
      setStepMessage('')
    }
  }, [showLoading])

  const progressPercent = currentStep >= 0 ? ((currentStep + 1) / CONNECTION_STEPS.length) * 100 : 0

  return (
    <div className="relative flex flex-col items-center justify-center h-full w-full bg-background-secondary">
      {/* Logo - switches between welcome and loading animation */}
      <Lottie
        animationData={showLoading ? currentLoadingAnimation : currentWelcomeAnimation}
        className="w-[200px] h-[200px] mb-8 transition-opacity duration-300"
        loop
        autoplay
      />

      <h1 className="text-[42px] font-bold text-foreground mb-3">{t('title')}</h1>

      <p className="text-muted-foreground text-xl mb-8">{t('subtitle')}</p>

      {/* Connect Button */}
      <button
        onClick={connect}
        disabled={showLoading}
        className="relative text-xl font-medium px-16 py-5 rounded-full min-w-[340px] transition-all duration-300 bg-primary text-primary-foreground backdrop-blur-[20px] border border-white/20 disabled:opacity-70 disabled:cursor-not-allowed shadow-[0_8px_32px_hsl(var(--primary)/0.4)] [box-shadow:var(--glass-highlight)]"
      >
        {showLoading ? (
          <div className="flex items-center justify-center gap-3">
            <div className="w-6 h-6 border-2 border-primary-foreground/20 border-t-primary-foreground rounded-full animate-spin" />
            <span>{stepMessage || t('buttons.connecting', { ns: 'common' })}</span>
          </div>
        ) : (
          t('buttons.connect', { ns: 'common' })
        )}
      </button>

      {/* Progress Section */}
      <div className={`mt-8 w-[340px] transition-opacity duration-300 ${showLoading ? 'opacity-100' : 'opacity-0'}`}>
        {/* Progress Bar */}
        <div className="h-1.5 bg-foreground/10 rounded-full overflow-hidden mb-4">
          <div
            className="h-full gradient-primary transition-all duration-400 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Step Label */}
        <p className={`text-center text-sm ${error ? 'text-destructive' : 'text-muted-foreground'}`}>
          {error || (currentStep >= 0 ? CONNECTION_STEPS[currentStep] : '')}
        </p>
      </div>

      {/* Footer - hide when connecting */}
      <div
        className={`absolute bottom-8 text-center transition-opacity duration-300 ${showLoading ? 'opacity-0' : 'opacity-100'}`}
      >
        <p className="text-muted-foreground text-sm">{t('footer.peerToPeer')}</p>
        <p className="text-muted-foreground/50 text-xs mt-1">{t('footer.version', { version: APP_VERSION })}</p>
      </div>
    </div>
  )
}
