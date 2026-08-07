import { useEffect } from 'react'
import { applyThemeSelection } from '@/lib/theme-utils'
import { useThemeStore } from './store'

export function useThemeEffects(): void {
  const activeTheme = useThemeStore((state) => state.activeTheme)
  const customThemes = useThemeStore((state) => state.customThemes)

  useEffect(() => {
    applyThemeSelection(activeTheme, customThemes)
  }, [activeTheme, customThemes])
}
