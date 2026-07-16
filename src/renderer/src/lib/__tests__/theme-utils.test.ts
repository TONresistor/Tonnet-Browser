import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ThemeColors } from '@shared/types'
import { THEME_TOKEN_CSS_VARIABLES, THEME_TOKEN_KEYS } from '@shared/theme-tokens'
import {
  exportThemeToJson,
  importThemeFromJson,
  isValidHsl,
  RESISTANCE_DOG_COLORS,
  UTYA_DUCK_COLORS,
} from '../theme-utils'

const COLOR_VARIABLES = Object.fromEntries(
  THEME_TOKEN_KEYS.map((key) => [key, THEME_TOKEN_CSS_VARIABLES[key].slice(2)])
) as Record<keyof ThemeColors, string>

const globalsCss = readFileSync(new URL('../../styles/globals.css', import.meta.url), 'utf8')

function readThemeVariables(theme: 'resistance-dog' | 'utya-duck'): Record<string, string> {
  const selectorIndex = globalsCss.indexOf(`[data-theme='${theme}']`)
  if (selectorIndex === -1) throw new Error(`Missing CSS selector for ${theme}`)

  const blockStart = globalsCss.indexOf('{', selectorIndex)
  if (blockStart === -1) throw new Error(`Missing CSS block for ${theme}`)

  let depth = 0
  let blockEnd = -1
  for (let index = blockStart; index < globalsCss.length; index += 1) {
    if (globalsCss[index] === '{') depth += 1
    if (globalsCss[index] === '}') depth -= 1
    if (depth === 0) {
      blockEnd = index
      break
    }
  }
  if (blockEnd === -1) throw new Error(`Unclosed CSS block for ${theme}`)

  const variables: Record<string, string> = {}
  const declarations = globalsCss.slice(blockStart + 1, blockEnd)
  for (const match of declarations.matchAll(/^\s*--([a-z0-9-]+):\s*([^;]+);/gim)) {
    variables[match[1]] = match[2].trim()
  }
  return variables
}

function hslToRgb(hsl: string): [number, number, number] {
  const [h, s, l] = hsl.match(/[\d.]+/g)!.map(Number)
  const hue = h / 360
  const saturation = s / 100
  const lightness = l / 100
  const channel = (offset: number) => {
    const k = (offset + hue * 12) % 12
    const amplitude = saturation * Math.min(lightness, 1 - lightness)
    return lightness - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [channel(0), channel(8), channel(4)]
}

function relativeLuminance(hsl: string): number {
  const weights = [0.2126, 0.7152, 0.0722] as const
  return hslToRgb(hsl).reduce((total, channel, index) => {
    const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    return total + linear * weights[index]
  }, 0)
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first)
  const secondLuminance = relativeLuminance(second)
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05)
}

const TEXT_COLOR_PAIRS = [
  ['background', 'textPrimary'],
  ['background', 'heading'],
  ['background', 'chromeForeground'],
  ['card', 'cardForeground'],
  ['primary', 'primaryForeground'],
  ['secondary', 'secondaryForeground'],
  ['accent', 'accentForeground'],
  ['success', 'successForeground'],
  ['warning', 'warningForeground'],
  ['destructive', 'destructiveForeground'],
  ['info', 'infoForeground'],
] as const satisfies ReadonlyArray<readonly [keyof ThemeColors, keyof ThemeColors]>

describe('built-in theme color parity', () => {
  it.each([
    ['resistance-dog', RESISTANCE_DOG_COLORS],
    ['utya-duck', UTYA_DUCK_COLORS],
  ] as const)('%s matches every ThemeColors variable in globals.css', (theme, colors) => {
    const cssVariables = readThemeVariables(theme)
    const expected = Object.fromEntries(
      Object.entries(COLOR_VARIABLES).map(([field, cssVariable]) => [field, cssVariables[cssVariable]])
    )

    expect(Object.keys(colors).sort()).toEqual(Object.keys(COLOR_VARIABLES).sort())
    expect(colors).toEqual(expected)
  })

  it.each([
    ['resistance-dog', RESISTANCE_DOG_COLORS],
    ['utya-duck', UTYA_DUCK_COLORS],
  ] as const)('%s meets WCAG AA contrast for semantic text pairs', (_theme, colors) => {
    for (const [surface, content] of TEXT_COLOR_PAIRS) {
      expect(contrastRatio(colors[surface], colors[content]), `${surface}/${content}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each([
    ['resistance-dog', RESISTANCE_DOG_COLORS],
    ['utya-duck', UTYA_DUCK_COLORS],
  ] as const)('%s keeps generic icons distinguishable from browser surfaces', (_theme, colors) => {
    for (const surface of [colors.background, colors.backgroundSecondary, colors.card]) {
      expect(contrastRatio(surface, colors.icon)).toBeGreaterThanOrEqual(3)
    }
  })

  it.each([
    ['resistance-dog', RESISTANCE_DOG_COLORS],
    ['utya-duck', UTYA_DUCK_COLORS],
  ] as const)('%s keeps small secondary text readable on every base surface', (_theme, colors) => {
    for (const surface of [colors.background, colors.backgroundSecondary, colors.card, colors.muted, colors.input]) {
      expect(contrastRatio(surface, colors.textSecondary)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each([
    ['resistance-dog', RESISTANCE_DOG_COLORS],
    ['utya-duck', UTYA_DUCK_COLORS],
  ] as const)('%s keeps destructive action text white', (_theme, colors) => {
    expect(colors.destructiveForeground).toBe('0 0% 100%')
  })

  it('accepts the current manifest and rejects unknown versions', () => {
    const theme = {
      id: 'manifest-test',
      name: 'Manifest test',
      colors: RESISTANCE_DOG_COLORS,
      isDark: true,
      createdAt: 1,
      updatedAt: 1,
    }
    const manifest = JSON.parse(exportThemeToJson(theme)) as Record<string, unknown>

    expect(manifest.version).toBe(3)
    expect(importThemeFromJson(JSON.stringify(manifest))).toMatchObject({
      name: theme.name,
      colors: theme.colors,
      isDark: true,
    })
    expect(importThemeFromJson(JSON.stringify({ ...manifest, version: 4 }))).toBeNull()
  })

  it('migrates a v1 manifest into independent semantic roles', () => {
    const legacyColors = { ...RESISTANCE_DOG_COLORS } as Record<string, string>
    legacyColors.foreground = legacyColors.textPrimary
    legacyColors.mutedForeground = legacyColors.textSecondary
    delete legacyColors.textPrimary
    delete legacyColors.textSecondary
    delete legacyColors.heading
    delete legacyColors.chromeForeground
    delete legacyColors.icon

    const imported = importThemeFromJson(
      JSON.stringify({ version: 1, name: 'Legacy', isDark: true, colors: legacyColors })
    )

    expect(imported?.colors).toMatchObject({
      textPrimary: legacyColors.foreground,
      textSecondary: legacyColors.mutedForeground,
      heading: legacyColors.foreground,
      chromeForeground: legacyColors.foreground,
      icon: legacyColors.foreground,
    })
    expect(imported?.colors).not.toHaveProperty('foreground')
    expect(imported?.colors).not.toHaveProperty('mutedForeground')
  })

  it('preserves a v2 manifest icon while splitting its text and chrome roles', () => {
    const legacyColors = { ...RESISTANCE_DOG_COLORS, icon: '180 50% 50%' } as Record<string, string>
    legacyColors.foreground = legacyColors.textPrimary
    legacyColors.mutedForeground = legacyColors.textSecondary
    delete legacyColors.textPrimary
    delete legacyColors.textSecondary
    delete legacyColors.heading
    delete legacyColors.chromeForeground

    const imported = importThemeFromJson(
      JSON.stringify({ version: 2, name: 'Legacy v2', isDark: true, colors: legacyColors })
    )

    expect(imported?.colors.icon).toBe('180 50% 50%')
    expect(imported?.colors.heading).toBe(legacyColors.foreground)
    expect(imported?.colors.chromeForeground).toBe(legacyColors.foreground)
  })

  it('only accepts the canonical safe HSL payload format', () => {
    expect(isValidHsl('200 100% 46%')).toBe(true)
    expect(isValidHsl('200.5 99.5% 46.25%')).toBe(true)
    expect(isValidHsl('hsl(200 100% 46%)')).toBe(false)
    expect(isValidHsl('prefix 200 100% 46%')).toBe(false)
    expect(isValidHsl('200, 100%, 46%')).toBe(false)
    expect(isValidHsl('361 100% 46%')).toBe(false)
  })
})
