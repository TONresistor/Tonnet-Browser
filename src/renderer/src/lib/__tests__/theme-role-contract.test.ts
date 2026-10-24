import { describe, expect, it } from 'vitest'
import { THEME_TOKEN_KEYS } from '@shared/theme-tokens'

describe('semantic theme-role contract', () => {
  it('exposes explicit content roles instead of the legacy foreground catch-all', () => {
    expect(THEME_TOKEN_KEYS).toEqual(
      expect.arrayContaining(['textPrimary', 'textSecondary', 'heading', 'chromeForeground', 'icon'])
    )
    expect(THEME_TOKEN_KEYS).not.toEqual(expect.arrayContaining(['foreground', 'mutedForeground']))
  })
})
