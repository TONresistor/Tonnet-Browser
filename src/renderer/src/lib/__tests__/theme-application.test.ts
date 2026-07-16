// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import type { CustomTheme } from '@shared/types'
import {
  applyCustomTheme,
  applyThemeSelection,
  removeCustomTheme,
  RESISTANCE_DOG_COLORS,
  UTYA_DUCK_COLORS,
} from '../theme-utils'

const lightTheme: CustomTheme = {
  id: 'light-custom',
  name: 'Light custom',
  colors: { ...UTYA_DUCK_COLORS },
  isDark: false,
  createdAt: 1,
  updatedAt: 1,
}

afterEach(() => {
  document.documentElement.style.cssText = ''
  document.documentElement.removeAttribute('data-theme')
})

describe('custom theme application', () => {
  it('derives every browser surface from the custom palette', () => {
    applyCustomTheme(lightTheme)

    const style = document.documentElement.style
    expect(document.documentElement.dataset.theme).toBe('custom:light-custom')
    expect(style.getPropertyValue('--background')).toBe(lightTheme.colors.background)
    expect(style.getPropertyValue('--foreground')).toBe(lightTheme.colors.textPrimary)
    expect(style.getPropertyValue('--muted-foreground')).toBe(lightTheme.colors.textSecondary)
    expect(style.getPropertyValue('--heading')).toBe(lightTheme.colors.heading)
    expect(style.getPropertyValue('--chrome-foreground')).toBe(lightTheme.colors.chromeForeground)
    expect(style.getPropertyValue('--icon')).toBe(lightTheme.colors.icon)
    expect(style.getPropertyValue('--popover')).toBe(lightTheme.colors.card)
    expect(style.getPropertyValue('--elevation-0')).toBe(lightTheme.colors.backgroundSecondary)
    expect(style.getPropertyValue('--elevation-1')).toBe(lightTheme.colors.background)
    expect(style.getPropertyValue('--elevation-2')).toBe(lightTheme.colors.card)
    expect(style.getPropertyValue('--elevation-3')).not.toBe('')
    expect(style.getPropertyValue('--elevation-4')).not.toBe('')
    expect(style.getPropertyValue('--glass-tint')).toBe('rgba(0, 0, 0, 0.04)')
  })

  it('cleans only properties owned by the theme resolver', () => {
    const style = document.documentElement.style
    style.setProperty('--unrelated-runtime-value', 'keep-me')
    applyCustomTheme(lightTheme)

    removeCustomTheme()

    expect(style.getPropertyValue('--background')).toBe('')
    expect(style.getPropertyValue('--icon')).toBe('')
    expect(style.getPropertyValue('--glass-tint')).toBe('')
    expect(style.getPropertyValue('--elevation-4')).toBe('')
    expect(style.getPropertyValue('--unrelated-runtime-value')).toBe('keep-me')
  })

  it('resolves persisted custom and built-in selections through one application path', () => {
    const darkTheme: CustomTheme = {
      ...lightTheme,
      id: 'persisted-dark',
      colors: { ...RESISTANCE_DOG_COLORS },
      isDark: true,
    }

    applyThemeSelection('custom:persisted-dark', [darkTheme])
    expect(document.documentElement.dataset.theme).toBe('custom:persisted-dark')
    expect(document.documentElement.style.getPropertyValue('--background')).toBe(darkTheme.colors.background)

    applyThemeSelection('utya-duck', [darkTheme])
    expect(document.documentElement.dataset.theme).toBe('utya-duck')
    expect(document.documentElement.style.getPropertyValue('--background')).toBe('')
  })
})
