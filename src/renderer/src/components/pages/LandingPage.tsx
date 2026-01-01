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
import { usePreferences } from '@/stores/preferences'

const CONNECTION_STEPS = [
  'Starting proxy...',
  'Loading configuration...',
  'Syncing with DHT...',
  'Connecting to network...',
  'Ready!'
]

export function LandingPage() {
  const { isConnecting, error, connect } = useProxy()
  const [currentStep, setCurrentStep] = useState(-1)
  const [stepMessage, setStepMessage] = useState('')
  const { theme } = usePreferences()
  const isYellow = theme === 'utya-duck'

  const currentWelcomeAnimation = isYellow ? welcomeYellowAnimation : welcomeAnimation
  const currentLoadingAnimation = isYellow ? loadingYellowAnimation : loadingAnimation

  // Listen for proxy progress events
  useEffect(() => {
    const unsubProgress = window.electron.on('proxy:progress', (...args: unknown[]) => {
      const data = args[0] as { step: number; message: string }
      setCurrentStep(data.step)
      setStepMessage(data.message)
    })

    return () => {
      unsubProgress()
    }
  }, [])

  // Reset step when not connecting
  useEffect(() => {
    if (!isConnecting) {
      setCurrentStep(-1)
      setStepMessage('')
    }
  }, [isConnecting])

  const progressPercent = currentStep >= 0 ? ((currentStep + 1) / CONNECTION_STEPS.length) * 100 : 0

  return (
    <div className="relative flex flex-col items-center justify-center h-full w-full bg-background-secondary">
      {/* Logo - switches between welcome and loading animation */}
      <Lottie
        animationData={isConnecting ? currentLoadingAnimation : currentWelcomeAnimation}
        className="w-[200px] h-[200px] mb-8 transition-opacity duration-300"
        loop
        autoplay
      />

      <h1 className="text-[42px] font-bold text-foreground mb-3">TON Browser</h1>

      <p className="text-muted-foreground text-xl mb-8">Explore the decentralized TON Network.</p>

      {/* Connect Button */}
      <button
        onClick={connect}
        disabled={isConnecting}
        className="relative text-xl font-medium px-16 py-5 rounded-full min-w-[340px] transition-all duration-300 bg-primary text-primary-foreground backdrop-blur-[20px] border border-white/20 disabled:opacity-70 disabled:cursor-not-allowed"
        style={{
          boxShadow: '0 8px 32px rgba(0, 136, 204, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
        }}
      >
        {isConnecting ? (
          <div className="flex items-center justify-center gap-3">
            <div className="w-6 h-6 border-2 border-primary-foreground/20 border-t-primary-foreground rounded-full animate-spin" />
            <span>{stepMessage || 'Connecting...'}</span>
          </div>
        ) : (
          'Connect to TON Network'
        )}
      </button>

      {/* Progress Section */}
      <div className={`mt-8 w-[340px] transition-opacity duration-300 ${isConnecting ? 'opacity-100' : 'opacity-0'}`}>
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
      <div className={`absolute bottom-8 text-center transition-opacity duration-300 ${isConnecting ? 'opacity-0' : 'opacity-100'}`}>
        <p className="text-muted-foreground text-sm">Peer-to-peer - Censorship Resistant - No Tracking</p>
        <p className="text-muted-foreground/50 text-xs mt-1">v{APP_VERSION}</p>
      </div>
    </div>
  )
}
