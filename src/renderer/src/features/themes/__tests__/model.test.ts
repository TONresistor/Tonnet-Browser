import { describe, expect, it } from 'vitest'
import { createThemeFromBase } from '@/lib/theme-utils'
import {
  customThemeValue,
  duplicateThemeDraft,
  isThemeDraftDirty,
  normalizeTheme,
  removeTheme,
  upsertTheme,
} from '../model'

describe('theme model', () => {
  it('normalizes optional copy and replaces an existing theme without mutating the source list', () => {
    const original = createThemeFromBase('resistance-dog', 'Original')
    const source = [original]
    const edited = { ...original, name: '  Renamed  ', description: '   ' }

    const result = upsertTheme(source, edited)

    expect(source).toEqual([original])
    expect(result[0].name).toBe('Renamed')
    expect(result[0]).not.toHaveProperty('description')
  })

  it('creates a detached duplicate draft', () => {
    const original = createThemeFromBase('utya-duck', 'Sunny')
    const duplicate = duplicateThemeDraft(original, '(Copy)')

    expect(duplicate.id).not.toBe(original.id)
    expect(duplicate.name).toBe('Sunny (Copy)')
    expect(duplicate.colors).toEqual(original.colors)
    expect(duplicate.colors).not.toBe(original.colors)
  })

  it('falls back atomically when the active custom theme is removed', () => {
    const theme = normalizeTheme(createThemeFromBase('resistance-dog', 'Custom'))

    expect(removeTheme([theme], customThemeValue(theme.id), theme.id)).toEqual({
      customThemes: [],
      activeTheme: 'resistance-dog',
    })
  })

  it('detects detached and modified drafts', () => {
    const original = createThemeFromBase('resistance-dog', 'Original')

    expect(isThemeDraftDirty({ ...original, colors: { ...original.colors } }, original)).toBe(false)
    expect(isThemeDraftDirty({ ...original, name: 'Changed' }, original)).toBe(true)
    expect(isThemeDraftDirty(original, null)).toBe(true)
  })
})
