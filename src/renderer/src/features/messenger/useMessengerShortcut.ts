import { useEffect, useState } from 'react'
import { createLogger } from '@/logger'
import { messengerClient } from './client'

const log = createLogger('messenger-shortcut')

export function useMessengerShortcut(preferenceValue: boolean): boolean {
  const [visible, setVisible] = useState(preferenceValue)

  useEffect(() => setVisible(preferenceValue), [preferenceValue])

  useEffect(() => {
    let active = true
    messengerClient
      .getSettings()
      .then((settings) => {
        if (active) setVisible(Boolean(settings.networkEnabled))
      })
      .catch((error) => log.error('Failed to load shortcut state:', error))

    const unsubscribe = messengerClient.onSettingsChanged((change) => {
      if (change.reset) {
        setVisible(false)
      } else if (change.category === 'messenger') {
        const next = (change.values as { networkEnabled?: unknown } | undefined)?.networkEnabled
        if (typeof next === 'boolean') setVisible(next)
      }
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return visible
}
