import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { THEME_TOKEN_KEYS } from '@shared/theme-tokens'

const readRendererFile = (relativePath: string) =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8')

describe('semantic theme-role contract', () => {
  it('exposes explicit content roles instead of the legacy foreground catch-all', () => {
    expect(THEME_TOKEN_KEYS).toEqual(
      expect.arrayContaining(['textPrimary', 'textSecondary', 'heading', 'chromeForeground', 'icon'])
    )
    expect(THEME_TOKEN_KEYS).not.toEqual(expect.arrayContaining(['foreground', 'mutedForeground']))
  })

  it('keeps browser chrome, headings, and standalone settings icons independent', () => {
    const statusBar = readRendererFile('components/browser/StatusBar.tsx')
    const addressBar = readRendererFile('components/browser/AddressBar.tsx')
    const sortableTab = readRendererFile('components/browser/SortableTab.tsx')
    const tabBar = readRendererFile('components/browser/TabBar.tsx')
    const settingsSections = readRendererFile('features/settings/components/constants.ts')
    const sectionHeader = readRendererFile('features/settings/components/shared/SectionHeader.tsx')
    const bookmarksPage = readRendererFile('features/bookmarks/components/BookmarksPage.tsx')
    const errorBoundary = readRendererFile('components/ErrorBoundary.tsx')

    expect(statusBar).toContain('text-chrome-foreground')
    expect(addressBar).toContain('text-chrome-foreground')
    expect(`${statusBar}\n${addressBar}\n${sortableTab}\n${tabBar}`).not.toMatch(/text-chrome-foreground\/\d+/)
    expect(sortableTab).toContain('rounded-full text-icon transition-opacity')
    expect(tabBar).toContain('flex-shrink-0 text-icon/60')
    expect(settingsSections).toContain("tileClass: 'bg-muted text-icon'")
    expect(sectionHeader).toContain('text-heading')
    expect(bookmarksPage.match(/<h3[^>]*text-heading/g)).toHaveLength(4)
    expect(errorBoundary).toContain('font-bold text-heading')
  })

  it('keeps settings navigation icons consistent and the wallet shortcut brand-blue', () => {
    const settingsSections = readRendererFile('features/settings/components/constants.ts')
    const statusBar = readRendererFile('components/browser/StatusBar.tsx')
    const globalStyles = readRendererFile('styles/globals.css')
    const tileClasses = [...settingsSections.matchAll(/tileClass: '([^']+)'/g)].map((match) => match[1])

    expect(tileClasses).toHaveLength(11)
    expect(tileClasses.every((className) => className.split(' ').includes('text-icon'))).toBe(true)
    expect(statusBar).toContain('className="flex items-center gap-1 text-tonsite transition-colors"')
    expect(statusBar).toContain('<AppIcon name="wallet" className="h-3 w-3" />')
    expect(globalStyles).toContain('--color-tonsite: #0098ea;')
  })

  it('keeps the landing connection action on the fixed TON identity colors', () => {
    const landingPage = readRendererFile('components/pages/LandingPage.tsx')
    const globalStyles = readRendererFile('styles/globals.css')

    expect(landingPage).toContain('bg-tonsite text-identity-foreground')
    expect(landingPage).toContain('border border-identity-foreground/20')
    expect(landingPage).toContain('border-identity-foreground/20 border-t-identity-foreground')
    expect(landingPage).toContain('shadow-tonsite')
    expect(globalStyles).toContain('--shadow-tonsite:')
  })
})
