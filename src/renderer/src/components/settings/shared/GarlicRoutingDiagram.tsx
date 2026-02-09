/**
 * Diagramme de routing Garlic pour la section General
 */

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

const DIAGRAM_COLOR = 'rgba(255, 255, 255, 0.5)'
const DIAGRAM_COLOR_ACTIVE = 'rgba(255, 255, 255, 0.8)'

export function GarlicRoutingDiagram() {
  const { t } = useTranslation('settings')
  const [relayIds, setRelayIds] = useState([
    Math.floor(Math.random() * 100) + 1,
    Math.floor(Math.random() * 100) + 1,
    Math.floor(Math.random() * 100) + 1,
  ])
  const [phase, setPhase] = useState<'forward' | 'backward'>('forward')
  const [step, setStep] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [circuitCount, setCircuitCount] = useState(0)

  useEffect(() => {
    if (!isPlaying) return

    const interval = setInterval(() => {
      setStep((prevStep) => {
        if (prevStep >= 4) {
          return -1
        }
        return prevStep + 1
      })
    }, 700)

    return () => clearInterval(interval)
  }, [isPlaying])

  useEffect(() => {
    if (step === -1) {
      setPhase((prevPhase) => {
        if (prevPhase === 'backward') {
          const newCount = circuitCount + 1
          setCircuitCount(newCount)

          if (newCount >= 2) {
            setIsPlaying(false)
            setCircuitCount(0)
            setStep(0)
            return 'forward'
          }

          setRelayIds([
            Math.floor(Math.random() * 100) + 1,
            Math.floor(Math.random() * 100) + 1,
            Math.floor(Math.random() * 100) + 1,
          ])
        }
        return prevPhase === 'forward' ? 'backward' : 'forward'
      })
      if (isPlaying) setStep(0)
    }
  }, [step, circuitCount, isPlaying])

  const handlePlayPause = () => {
    if (isPlaying) {
      setIsPlaying(false)
      setStep(0)
      setPhase('forward')
      setCircuitCount(0)
    } else {
      setCircuitCount(0)
      setPhase('forward')
      setStep(0)
      setIsPlaying(true)
    }
  }

  const isSegmentActive = (segmentIndex: number) => {
    if (!isPlaying) return true
    if (phase === 'forward') {
      return step > segmentIndex
    } else {
      const reversedIndex = 3 - segmentIndex
      return step > reversedIndex
    }
  }

  const isNodeActive = (nodeIndex: number) => {
    if (!isPlaying) return true
    if (phase === 'forward') {
      return step === nodeIndex
    } else {
      return step === 4 - nodeIndex
    }
  }

  const isRelayPassed = (relayIndex: number) => {
    if (!isPlaying) return true
    const nodeIndex = relayIndex + 1
    if (phase === 'forward') {
      return step > nodeIndex
    } else {
      return step > 4 - nodeIndex
    }
  }

  return (
    <div className="py-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-foreground text-base font-semibold">{t('general.howItWorks')}</p>
        <button
          onClick={handlePlayPause}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-all bg-surface-hover border border-border-medium text-foreground-secondary"
        >
          {isPlaying ? (
            <>
              <span className="w-2 h-2 flex items-center justify-center">▪</span>
              {t('general.stop')}
            </>
          ) : (
            <>
              <span className="w-2 h-2 flex items-center justify-center">▶</span>
              {t('general.play')}
            </>
          )}
        </button>
      </div>
      <p className="text-muted-foreground text-base mb-5 leading-relaxed">{t('general.routingDescription')}</p>

      <div className="relative h-24 w-full">
        <svg className="w-full h-full" viewBox="0 0 500 96" preserveAspectRatio="xMidYMid meet">
          {[0, 1, 2, 3].map((i) => {
            const x1 = 50 + i * 100
            const x2 = 50 + (i + 1) * 100
            const isActive = isSegmentActive(i)

            return (
              <g key={`segment-${i}`}>
                <line x1={x1 + 18} y1={36} x2={x2 - 18} y2={36} stroke="rgba(255, 255, 255, 0.1)" strokeWidth="2" />
                <line
                  x1={x1 + 18}
                  y1={36}
                  x2={x2 - 18}
                  y2={36}
                  stroke={DIAGRAM_COLOR}
                  strokeWidth="2"
                  style={{
                    opacity: isActive ? 1 : 0,
                    transition: 'opacity 0.3s ease',
                  }}
                />
                {isPlaying && isActive && (
                  <polygon
                    points={
                      phase === 'forward'
                        ? `${x2 - 22},32 ${x2 - 22},40 ${x2 - 14},36`
                        : `${x1 + 22},32 ${x1 + 22},40 ${x1 + 14},36`
                    }
                    fill={DIAGRAM_COLOR}
                  />
                )}
              </g>
            )
          })}

          <g>
            <text x="50" y="12" textAnchor="middle" fill="rgba(255, 255, 255, 0.9)" fontSize="12" fontWeight="600">
              {t('general.you')}
            </text>
            <circle
              cx="50"
              cy="36"
              r="16"
              fill={isNodeActive(0) ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.08)'}
              stroke={isNodeActive(0) ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 255, 255, 0.2)'}
              strokeWidth="2"
              style={{ transition: 'all 0.3s ease' }}
            />
            {isPlaying && (
              <text x="50" y="68" textAnchor="middle" fill="rgba(255, 255, 255, 0.5)" fontSize="11">
                {phase === 'forward' ? t('general.encrypts') : t('general.decrypts')}
              </text>
            )}
          </g>

          {[0, 1, 2].map((i) => {
            const cx = 150 + i * 100
            const isPassed = isRelayPassed(i)
            const isActive = isNodeActive(i + 1)
            const actionText = phase === 'forward' ? t('general.peels') : t('general.wraps')

            return (
              <g key={`relay-${i}`}>
                <circle
                  cx={cx}
                  cy={36}
                  r="16"
                  fill={isActive || isPassed ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.04)'}
                  stroke={isActive || isPassed ? DIAGRAM_COLOR : 'rgba(255, 255, 255, 0.15)'}
                  strokeWidth="2"
                  style={{ transition: 'all 0.3s ease' }}
                />
                <text x={cx} y="68" textAnchor="middle" fill="rgba(255, 255, 255, 0.6)" fontSize="11">
                  {t('general.relay')} {relayIds[i]}
                </text>
                {isPlaying && (isActive || isPassed) && (
                  <text x={cx} y="84" textAnchor="middle" fill="rgba(255, 255, 255, 0.4)" fontSize="10">
                    {actionText}
                  </text>
                )}
              </g>
            )
          })}

          <g>
            <text x="450" y="12" textAnchor="middle" fill="rgba(255, 255, 255, 0.9)" fontSize="12" fontWeight="600">
              .ton
            </text>
            <circle
              cx="450"
              cy="36"
              r="16"
              fill={isNodeActive(4) ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.08)'}
              stroke={isNodeActive(4) ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 255, 255, 0.2)'}
              strokeWidth="2"
              style={{ transition: 'all 0.3s ease' }}
            />
            {isPlaying && (
              <text x="450" y="68" textAnchor="middle" fill="rgba(255, 255, 255, 0.5)" fontSize="11">
                {phase === 'forward' ? t('general.receives') : t('general.responds')}
              </text>
            )}
          </g>

          {isPlaying && (
            <circle
              cx={phase === 'forward' ? 50 + step * 100 : 450 - step * 100}
              cy={36}
              r="6"
              fill={DIAGRAM_COLOR_ACTIVE}
              style={{
                transition: 'cx 0.6s ease-in-out',
              }}
            />
          )}
        </svg>
      </div>

      <p className="text-xs text-muted-foreground/60 text-center mt-4">{t('general.newCircuit')}</p>
    </div>
  )
}
