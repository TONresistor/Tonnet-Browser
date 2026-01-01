/**
 * Theme utilities for color conversion, validation, and application.
 */

import type { ThemeColors, CustomTheme } from '@shared/types'

// Default theme colors (resistance-dog theme)
export const RESISTANCE_DOG_COLORS: ThemeColors = {
  background: '210 26% 13%',
  backgroundSecondary: '210 32% 9%',
  foreground: '0 0% 96%',
  card: '210 24% 18%',
  cardForeground: '0 0% 96%',
  primary: '210 44% 53%',
  primaryForeground: '0 0% 100%',
  secondary: '210 24% 18%',
  secondaryForeground: '0 0% 96%',
  accent: '207 83% 68%',
  accentForeground: '0 0% 100%',
  muted: '210 22% 15%',
  mutedForeground: '210 18% 52%',
  destructive: '356 82% 58%',
  destructiveForeground: '0 0% 100%',
  success: '142 76% 36%',
  successForeground: '0 0% 100%',
  warning: '38 92% 50%',
  warningForeground: '0 0% 0%',
  info: '199 89% 48%',
  infoForeground: '0 0% 100%',
  border: '210 22% 22%',
  input: '210 24% 18%',
  ring: '207 83% 68%',
}

// Utya Duck theme colors
export const UTYA_DUCK_COLORS: ThemeColors = {
  background: '50 100% 60%',
  backgroundSecondary: '48 100% 55%',
  foreground: '0 0% 8%',
  card: '52 100% 65%',
  cardForeground: '0 0% 8%',
  primary: '200 85% 55%',
  primaryForeground: '0 0% 100%',
  secondary: '48 90% 55%',
  secondaryForeground: '0 0% 8%',
  accent: '200 80% 45%',
  accentForeground: '0 0% 100%',
  muted: '48 80% 65%',
  mutedForeground: '0 0% 15%',
  destructive: '0 80% 45%',
  destructiveForeground: '0 0% 100%',
  success: '142 80% 30%',
  successForeground: '0 0% 100%',
  warning: '15 90% 40%',
  warningForeground: '0 0% 100%',
  info: '210 90% 35%',
  infoForeground: '0 0% 100%',
  border: '40 70% 35%',
  input: '52 100% 62%',
  ring: '200 85% 55%',
}

/**
 * Convert HSL string "H S% L%" to hex color "#RRGGBB"
 */
export function hslToHex(hsl: string): string {
  const parts = hsl.match(/(\d+(?:\.\d+)?)/g)
  if (!parts || parts.length < 3) return '#000000'

  const h = parseFloat(parts[0]) / 360
  const s = parseFloat(parts[1]) / 100
  const l = parseFloat(parts[2]) / 100

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
  const parts = hsl.match(/(\d+(?:\.\d+)?)/g)
  if (!parts || parts.length < 3) return { h: 0, s: 0, l: 0 }
  return {
    h: parseFloat(parts[0]),
    s: parseFloat(parts[1]),
    l: parseFloat(parts[2]),
  }
}

/**
 * Format HSL object to string
 */
export function formatHsl(hsl: { h: number; s: number; l: number }): string {
  return `${Math.round(hsl.h)} ${Math.round(hsl.s)}% ${Math.round(hsl.l)}%`
}

/**
 * Convert camelCase to kebab-case
 */
function camelToKebab(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}

/**
 * Apply a custom theme to the document
 */
export function applyCustomTheme(theme: CustomTheme): void {
  const root = document.documentElement

  // Set custom theme marker
  root.setAttribute('data-theme', `custom:${theme.id}`)

  // Inject CSS variables
  Object.entries(theme.colors).forEach(([key, value]) => {
    const cssVar = `--${camelToKebab(key)}`
    root.style.setProperty(cssVar, value)
  })

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
  root.style.setProperty(
    '--primary-glow',
    `hsla(${primaryHsl.h}, ${primaryHsl.s}%, ${primaryHsl.l}%, 0.4)`
  )
  root.style.setProperty(
    '--destructive-glow',
    `hsla(${destructiveHsl.h}, ${destructiveHsl.s}%, ${destructiveHsl.l}%, 0.3)`
  )

  // Button highlight
  root.style.setProperty('--button-highlight', 'rgba(255, 255, 255, 0.2)')
}

/**
 * Remove custom theme styles and restore built-in theme
 */
export function removeCustomTheme(): void {
  const root = document.documentElement

  // Clear all custom CSS properties
  root.style.cssText = ''
}

/**
 * Validate theme colors object
 */
export function validateColors(colors: unknown): colors is ThemeColors {
  if (!colors || typeof colors !== 'object') return false

  const required: (keyof ThemeColors)[] = [
    'background',
    'backgroundSecondary',
    'foreground',
    'card',
    'cardForeground',
    'primary',
    'primaryForeground',
    'secondary',
    'secondaryForeground',
    'accent',
    'accentForeground',
    'muted',
    'mutedForeground',
    'destructive',
    'destructiveForeground',
    'success',
    'successForeground',
    'warning',
    'warningForeground',
    'info',
    'infoForeground',
    'border',
    'input',
    'ring',
  ]

  const c = colors as Record<string, unknown>
  return required.every(
    (key) => typeof c[key] === 'string' && isValidHsl(c[key] as string)
  )
}

/**
 * Validate HSL string format
 */
export function isValidHsl(hsl: string): boolean {
  const parts = hsl.match(/(\d+(?:\.\d+)?)/g)
  if (!parts || parts.length < 3) return false

  const h = parseFloat(parts[0])
  const s = parseFloat(parts[1])
  const l = parseFloat(parts[2])

  return h >= 0 && h <= 360 && s >= 0 && s <= 100 && l >= 0 && l <= 100
}

/**
 * Validate a complete theme object
 */
export function validateTheme(theme: unknown): theme is CustomTheme {
  if (!theme || typeof theme !== 'object') return false

  const t = theme as Record<string, unknown>
  return (
    typeof t.id === 'string' &&
    typeof t.name === 'string' &&
    typeof t.isDark === 'boolean' &&
    typeof t.createdAt === 'number' &&
    typeof t.updatedAt === 'number' &&
    validateColors(t.colors)
  )
}

/**
 * Generate a unique theme ID
 */
export function generateThemeId(): string {
  return `theme_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Create a new theme from a base
 */
export function createThemeFromBase(
  base: 'resistance-dog' | 'utya-duck',
  name: string
): CustomTheme {
  const colors =
    base === 'resistance-dog' ? RESISTANCE_DOG_COLORS : UTYA_DUCK_COLORS
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
      version: 1,
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
    if (typeof data.name !== 'string') return null
    if (typeof data.isDark !== 'boolean') return null
    if (!validateColors(data.colors)) return null

    const now = Date.now()
    return {
      id: generateThemeId(),
      name: data.name,
      description: data.description,
      colors: data.colors,
      isDark: data.isDark,
      createdAt: now,
      updatedAt: now,
    }
  } catch {
    return null
  }
}

/**
 * Calculate relative luminance for contrast checking
 */
function getLuminance(hsl: string): number {
  const hex = hslToHex(hsl)
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return 0

  const r = parseInt(result[1], 16) / 255
  const g = parseInt(result[2], 16) / 255
  const b = parseInt(result[3], 16) / 255

  const toLinear = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

/**
 * Calculate WCAG contrast ratio between two colors
 */
export function getContrastRatio(fg: string, bg: string): number {
  const l1 = getLuminance(fg)
  const l2 = getLuminance(bg)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Check if contrast meets WCAG AA standard (4.5:1 for normal text)
 */
export function meetsContrastAA(fg: string, bg: string): boolean {
  return getContrastRatio(fg, bg) >= 4.5
}
