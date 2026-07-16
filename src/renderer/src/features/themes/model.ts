import type { CustomTheme } from '@shared/types'
import type { ThemeType } from '@shared/defaults'
import { generateThemeId } from '@/lib/theme-utils'

export function normalizeTheme(theme: CustomTheme): CustomTheme {
  const normalized = {
    ...theme,
    name: theme.name.trim(),
    updatedAt: Date.now(),
  }
  const description = theme.description?.trim()
  if (description) return { ...normalized, description }
  const withoutDescription = { ...normalized }
  delete withoutDescription.description
  return withoutDescription
}

export function upsertTheme(themes: CustomTheme[], theme: CustomTheme): CustomTheme[] {
  const normalized = normalizeTheme(theme)
  const index = themes.findIndex((candidate) => candidate.id === normalized.id)
  if (index === -1) return [...themes, normalized]
  return themes.map((candidate) => (candidate.id === normalized.id ? normalized : candidate))
}

export function duplicateThemeDraft(theme: CustomTheme, copyLabel: string): CustomTheme {
  const now = Date.now()
  return {
    ...theme,
    id: generateThemeId(),
    name: `${theme.name} ${copyLabel}`,
    colors: { ...theme.colors },
    createdAt: now,
    updatedAt: now,
  }
}

export function removeTheme(
  themes: CustomTheme[],
  activeTheme: ThemeType,
  themeId: string
): { customThemes: CustomTheme[]; activeTheme: ThemeType } {
  return {
    customThemes: themes.filter((theme) => theme.id !== themeId),
    activeTheme: activeTheme === `custom:${themeId}` ? 'resistance-dog' : activeTheme,
  }
}

export function customThemeValue(themeId: string): ThemeType {
  return `custom:${themeId}`
}

export function isThemeDraftDirty(theme: CustomTheme, originalTheme: CustomTheme | null): boolean {
  return originalTheme === null || JSON.stringify(theme) !== JSON.stringify(originalTheme)
}
