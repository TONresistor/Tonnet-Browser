import { useEffect, useRef } from 'react'
import type { CustomTheme } from '@shared/types'
import { applyCustomTheme, applyThemeSelection } from '@/lib/theme-utils'
import { useThemeStore } from './store'

function restorePersistedTheme(): void {
  const { activeTheme, customThemes } = useThemeStore.getState()
  applyThemeSelection(activeTheme, customThemes)
}

export function useThemeDraftPreview(theme: CustomTheme, enabled: boolean): void {
  const previewingRef = useRef(false)

  useEffect(() => {
    if (enabled) {
      applyCustomTheme(theme)
      previewingRef.current = true
    } else if (previewingRef.current) {
      restorePersistedTheme()
      previewingRef.current = false
    }
  }, [enabled, theme])

  useEffect(
    () => () => {
      if (previewingRef.current) restorePersistedTheme()
    },
    []
  )
}
