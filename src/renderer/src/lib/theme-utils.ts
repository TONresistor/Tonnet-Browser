/**
 * Theme utilities for color conversion, validation, and application.
 */

import type { ThemeColors, CustomTheme } from '@shared/types'
import type { ThemeType } from '@shared/defaults'
import { BUILT_IN_THEME_COLORS, THEME_TOKEN_CSS_VARIABLES, THEME_TOKEN_KEYS } from '@shared/theme-tokens'

// Default theme colors (resistance-dog theme)
export const RESISTANCE_DOG_COLORS: ThemeColors = { ...BUILT_IN_THEME_COLORS['resistance-dog'] }

// Utya Duck theme colors
export const UTYA_DUCK_COLORS: ThemeColors = { ...BUILT_IN_THEME_COLORS['utya-duck'] }

/**
 * Extract the numeric H, S, L components from an "H S% L%" string.
 * Returns null when the string does not contain at least three numbers.
 */
function parseHslParts(hsl: string): [number, number, number] | null {
  const match = hsl.trim().match(/^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%$/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/**
 * Convert HSL string "H S% L%" to hex color "#RRGGBB"
 */
export function hslToHex(hsl: string): string {
  const parsed = parseHslParts(hsl)
  if (!parsed) return '#000000'

  const h = parsed[0] / 360
  const s = parsed[1] / 100
  const l = parsed[2] / 100

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }

  let r, g, b
  if (s === 0) {
    r = g = b = l
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1 / 3)
  }

  const toHex = (x: number) => {
    const hex = Math.round(x * 255).toString(16)
    return hex.length === 1 ? '0' + hex : hex
  }

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/**
 * Convert hex color "#RRGGBB" to HSL string "H S% L%"
 */
export function hexToHsl(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return '0 0% 0%'

  const r = parseInt(result[1], 16) / 255
  const g = parseInt(result[2], 16) / 255
  const b = parseInt(result[3], 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6
        break
      case g:
        h = ((b - r) / d + 2) / 6
        break
      case b:
        h = ((r - g) / d + 4) / 6
        break
    }
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}

/**
 * Parse HSL string to object
 */
export function parseHsl(hsl: string): { h: number; s: number; l: number } {
  const parsed = parseHslParts(hsl)
  if (!parsed) return { h: 0, s: 0, l: 0 }
  return { h: parsed[0], s: parsed[1], l: parsed[2] }
}

const DERIVED_THEME_PROPERTIES = [
  '--popover',
  '--popover-foreground',
  '--surface',
  '--surface-hover',
  '--surface-active',
  '--border-subtle',
  '--border-medium',
  '--border-strong',
  '--foreground-secondary',
  '--foreground-muted',
  '--shadow-color',
  '--primary-glow',
  '--destructive-glow',
  '--button-highlight',
  '--glass-blur',
  '--glass-tint',
  '--glass-wash',
  '--glass-border',
  '--glass-shadow',
  '--glass-highlight',
  '--elevation-0',
  '--elevation-1',
  '--elevation-2',
  '--elevation-3',
  '--elevation-4',
] as const

const CUSTOM_THEME_PROPERTIES = [...Object.values(THEME_TOKEN_CSS_VARIABLES), ...DERIVED_THEME_PROPERTIES]

function adjustLightness(hsl: string, delta: number): string {
  const { h, s, l } = parseHsl(hsl)
  return `${h} ${s}% ${Math.max(0, Math.min(100, l + delta))}%`
}

/**
 * Apply a custom theme to the document
 */
export function applyCustomTheme(theme: CustomTheme): void {
  const root = document.documentElement

  // Set custom theme marker
  root.setAttribute('data-theme', `custom:${theme.id}`)

  THEME_TOKEN_KEYS.forEach((key) => root.style.setProperty(THEME_TOKEN_CSS_VARIABLES[key], theme.colors[key]))

  root.style.setProperty('--popover', theme.colors.card)
  root.style.setProperty('--popover-foreground', theme.colors.cardForeground)

  // Handle surface variants based on isDark
  const surfaceBase = theme.isDark ? '0 0% 100%' : '0 0% 0%'
  root.style.setProperty('--surface', `${surfaceBase} / 0.06`)
  root.style.setProperty('--surface-hover', `${surfaceBase} / 0.08`)
  root.style.setProperty('--surface-active', `${surfaceBase} / 0.12`)

  // Border opacity variants
  root.style.setProperty('--border-subtle', `${surfaceBase} / 0.1`)
  root.style.setProperty('--border-medium', `${surfaceBase} / 0.15`)
  root.style.setProperty('--border-strong', `${surfaceBase} / 0.25`)

  // Text opacity variants
  root.style.setProperty('--foreground-secondary', `${surfaceBase} / 0.8`)
  root.style.setProperty('--foreground-muted', `${surfaceBase} / 0.6`)

  // Shadow base
  root.style.setProperty('--shadow-color', '0 0% 0%')

  // Glow colors (parse primary and destructive for glow)
  const primaryHsl = parseHsl(theme.colors.primary)
  const destructiveHsl = parseHsl(theme.colors.destructive)
  root.style.setProperty('--primary-glow', `hsla(${primaryHsl.h}, ${primaryHsl.s}%, ${primaryHsl.l}%, 0.4)`)
  root.style.setProperty(
    '--destructive-glow',
    `hsla(${destructiveHsl.h}, ${destructiveHsl.s}%, ${destructiveHsl.l}%, 0.3)`
  )

  // Button highlight
  root.style.setProperty('--button-highlight', 'rgba(255, 255, 255, 0.2)')

  root.style.setProperty('--glass-blur', '12px')
  root.style.setProperty('--glass-tint', theme.isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.04)')
  root.style.setProperty('--glass-wash', theme.isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.02)')
  root.style.setProperty('--glass-border', theme.isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.1)')
  root.style.setProperty(
    '--glass-shadow',
    theme.isDark
      ? '0 4px 24px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.08)'
      : '0 4px 24px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.5)'
  )
  root.style.setProperty(
    '--glass-highlight',
    theme.isDark ? 'inset 0 1px 0 rgba(255, 255, 255, 0.15)' : 'inset 0 1px 0 rgba(255, 255, 255, 0.4)'
  )
  root.style.setProperty('--elevation-0', theme.colors.backgroundSecondary)
  root.style.setProperty('--elevation-1', theme.colors.background)
  root.style.setProperty('--elevation-2', theme.colors.card)
  root.style.setProperty('--elevation-3', adjustLightness(theme.colors.card, theme.isDark ? 4 : 3))
  root.style.setProperty('--elevation-4', adjustLightness(theme.colors.card, theme.isDark ? 8 : 6))
}

/**
 * Remove custom theme styles and restore built-in theme
 */
export function removeCustomTheme(): void {
  const root = document.documentElement

  CUSTOM_THEME_PROPERTIES.forEach((property) => root.style.removeProperty(property))
}

/**
 * Validate theme colors object
 */
export function validateColors(colors: unknown): colors is ThemeColors {
  if (!colors || typeof colors !== 'object') return false

  const c = colors as Record<string, unknown>
  return THEME_TOKEN_KEYS.every((key) => typeof c[key] === 'string' && isValidHsl(c[key] as string))
}

function migrateManifestColors(colors: unknown, version: number): ThemeColors | null {
  if (!colors || typeof colors !== 'object' || Array.isArray(colors)) return null
  const source = colors as Record<string, unknown>
  const migrated =
    version < 3
      ? {
          ...source,
          textPrimary: source.textPrimary ?? source.foreground,
          textSecondary: source.textSecondary ?? source.mutedForeground,
          heading: source.heading ?? source.foreground,
          chromeForeground: source.chromeForeground ?? source.foreground,
          icon: source.icon ?? source.foreground,
        }
      : source

  const canonical = Object.fromEntries(THEME_TOKEN_KEYS.map((key) => [key, migrated[key]]))
  return validateColors(canonical) ? (canonical as ThemeColors) : null
}

/**
 * Validate HSL string format
 */
export function isValidHsl(hsl: string): boolean {
  const parsed = parseHslParts(hsl)
  if (!parsed) return false

  const [h, s, l] = parsed
  return h >= 0 && h <= 360 && s >= 0 && s <= 100 && l >= 0 && l <= 100
}

/**
 * Generate a unique theme ID
 */
export function generateThemeId(): string {
  return `theme_${crypto.randomUUID()}`
}

/**
 * Create a new theme from a base
 */
export function createThemeFromBase(base: 'resistance-dog' | 'utya-duck', name: string): CustomTheme {
  const colors = base === 'resistance-dog' ? RESISTANCE_DOG_COLORS : UTYA_DUCK_COLORS
  const isDark = base === 'resistance-dog'
  const now = Date.now()

  return {
    id: generateThemeId(),
    name,
    colors: { ...colors },
    isDark,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Export theme to JSON string
 */
export function exportThemeToJson(theme: CustomTheme): string {
  return JSON.stringify(
    {
      version: 3,
      name: theme.name,
      description: theme.description,
      isDark: theme.isDark,
      colors: theme.colors,
    },
    null,
    2
  )
}

/**
 * Import theme from JSON string
 */
export function importThemeFromJson(json: string): CustomTheme | null {
  try {
    const data = JSON.parse(json)

    if (!data || typeof data !== 'object') return null
    const version = data.version === undefined ? 1 : data.version
    if (version !== 1 && version !== 2 && version !== 3) return null
    if (typeof data.name !== 'string') return null
    if (typeof data.isDark !== 'boolean') return null
    if (data.description !== undefined && typeof data.description !== 'string') return null
    const colors = migrateManifestColors(data.colors, version)
    if (!colors) return null

    const now = Date.now()
    return {
      id: generateThemeId(),
      name: data.name,
      ...(data.description === undefined ? {} : { description: data.description }),
      colors,
      isDark: data.isDark,
      createdAt: now,
      updatedAt: now,
    }
  } catch {
    return null
  }
}

/**
 * Return the custom theme id from a "custom:<id>" marker, or null otherwise.
 */
export function parseCustomThemeId(theme: string): string | null {
  return theme.startsWith('custom:') ? theme.slice('custom:'.length) : null
}

export function applyThemeSelection(theme: ThemeType, customThemes: CustomTheme[]): void {
  const customThemeId = parseCustomThemeId(theme)
  if (customThemeId !== null) {
    const customTheme = customThemes.find((candidate) => candidate.id === customThemeId)
    if (customTheme) {
      applyCustomTheme(customTheme)
      return
    }

    removeCustomTheme()
    document.documentElement.setAttribute('data-theme', 'resistance-dog')
    return
  }

  removeCustomTheme()
  document.documentElement.setAttribute('data-theme', theme)
}
