/**
 * Tests for Content Filter Whitelist and Category Toggles.
 * Drives configuration through the public applySettings() contract.
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { ContentFilterManager } from '../filter-manager'
import type { ContentFilteringSettings } from '../../../shared/types'

const ALL_ENABLED: ContentFilteringSettings = {
  enabled: true,
  blockAds: true,
  blockTrackers: true,
  blockMiners: true,
  blockMalware: true,
  blockAnnoyances: true,
  whitelistedDomains: [],
}

describe('ContentFilterManager - Whitelist', () => {
  let manager: ContentFilterManager

  beforeEach(() => {
    manager = new ContentFilterManager()
  })

  const apply = (overrides: Partial<ContentFilteringSettings>) =>
    manager.applySettings({ ...ALL_ENABLED, ...overrides })

  describe('Whitelist functionality', () => {
    test('should allow all requests from whitelisted domain', () => {
      apply({ whitelistedDomains: ['trusted.ton'] })

      expect(manager.isBlocked('http://trusted.ton/ads/banner.jpg', 'image')).toBe(false)
      expect(manager.isBlocked('http://trusted.ton/track/analytics.js', 'script')).toBe(false)
      expect(manager.isBlocked('http://trusted.ton/miner.js', 'script')).toBe(false)
    })

    test('should be case-insensitive', () => {
      apply({ whitelistedDomains: ['Trusted.TON'] })

      expect(manager.isBlocked('http://trusted.ton/ads/banner.jpg', 'image')).toBe(false)
      expect(manager.isBlocked('http://TRUSTED.TON/ads/banner.jpg', 'image')).toBe(false)
    })

    test('should handle subdomain whitelisting correctly', () => {
      apply({ whitelistedDomains: ['example.ton'] })

      // Should allow example.ton
      expect(manager.isBlocked('http://example.ton/ads/banner.jpg', 'image')).toBe(false)

      // Should NOT allow subdomain (unless explicitly whitelisted)
      expect(manager.isBlocked('http://sub.example.ton/ads/banner.jpg', 'image')).toBe(true)
    })

    test('should set whitelist from array', () => {
      apply({ whitelistedDomains: ['site1.ton', 'site2.ton', 'site3.ton'] })

      expect(manager.isBlocked('http://site1.ton/ads/banner.jpg', 'image')).toBe(false)
      expect(manager.isBlocked('http://site2.ton/ads/banner.jpg', 'image')).toBe(false)
      expect(manager.isBlocked('http://site3.ton/ads/banner.jpg', 'image')).toBe(false)

      // Non-whitelisted should still be blocked
      expect(manager.isBlocked('http://other.ton/ads/banner.jpg', 'image')).toBe(true)
    })

    test('should replace entire whitelist on re-apply', () => {
      apply({ whitelistedDomains: ['site1.ton', 'site2.ton'] })
      apply({ whitelistedDomains: ['site3.ton'] })

      // Old entries should be removed
      expect(manager.isBlocked('http://site1.ton/ads/banner.jpg', 'image')).toBe(true)
      expect(manager.isBlocked('http://site2.ton/ads/banner.jpg', 'image')).toBe(true)

      // New entry should work
      expect(manager.isBlocked('http://site3.ton/ads/banner.jpg', 'image')).toBe(false)
    })

    test('should remove domain when re-applied without it', () => {
      apply({ whitelistedDomains: ['trusted.ton'] })
      expect(manager.isBlocked('http://trusted.ton/ads/banner.jpg', 'image')).toBe(false)

      apply({ whitelistedDomains: [] })
      expect(manager.isBlocked('http://trusted.ton/ads/banner.jpg', 'image')).toBe(true)
    })

    test('should handle invalid URLs gracefully', () => {
      apply({ whitelistedDomains: ['trusted.ton'] })

      // Invalid URL should not crash
      expect(manager.isBlocked('not-a-url', 'script')).toBe(false) // Returns false if enabled but no match
    })
  })

  describe('Category toggles', () => {
    test('should block when category is enabled', () => {
      apply({ blockAds: true })
      expect(manager.isBlocked('http://example.ton/ads/banner.jpg', 'image')).toBe(true)
    })

    test('should allow when category is disabled', () => {
      apply({ blockAds: false })
      expect(manager.isBlocked('http://example.ton/ads/banner.jpg', 'image')).toBe(false)
    })

    test('should independently control each category', () => {
      apply({ blockAds: true, blockTrackers: false, blockMiners: true })

      // Ads blocked
      expect(manager.isBlocked('http://example.ton/ads/banner.jpg', 'image')).toBe(true)

      // Trackers allowed
      expect(manager.isBlocked('http://example.ton/track/analytics.js', 'script')).toBe(false)

      // Miners blocked
      expect(manager.isBlocked('http://example.ton/coinhive.js', 'script')).toBe(true)
    })

    test('should respect category toggles for all categories', () => {
      // Disable all categories
      apply({
        blockAds: false,
        blockTrackers: false,
        blockMiners: false,
        blockMalware: false,
        blockAnnoyances: false,
      })

      // All should be allowed
      expect(manager.isBlocked('http://example.ton/ads/banner.jpg', 'image')).toBe(false)
      expect(manager.isBlocked('http://example.ton/track/analytics.js', 'script')).toBe(false)
      expect(manager.isBlocked('http://example.ton/coinhive.js', 'script')).toBe(false)
      expect(manager.isBlocked('http://example.ton/malware.exe', 'xhr')).toBe(false)
      expect(manager.isBlocked('http://example.ton/modal.js', 'script')).toBe(false)

      // Enable all categories
      apply({})

      // All should be blocked
      expect(manager.isBlocked('http://example.ton/ads/banner.jpg', 'image')).toBe(true)
      expect(manager.isBlocked('http://example.ton/track/analytics.js', 'script')).toBe(true)
      expect(manager.isBlocked('http://example.ton/coinhive.js', 'script')).toBe(true)
      expect(manager.isBlocked('http://example.ton/malware.exe', 'xhr')).toBe(true)
      expect(manager.isBlocked('http://example.ton/modal.js', 'script')).toBe(true)
    })
  })

  describe('Whitelist priority over category toggles', () => {
    test('whitelist should bypass all category filters', () => {
      apply({ whitelistedDomains: ['trusted.ton'] })

      // All should be allowed because domain is whitelisted
      expect(manager.isBlocked('http://trusted.ton/ads/banner.jpg', 'image')).toBe(false)
      expect(manager.isBlocked('http://trusted.ton/track/analytics.js', 'script')).toBe(false)
      expect(manager.isBlocked('http://trusted.ton/coinhive.js', 'script')).toBe(false)
      expect(manager.isBlocked('http://trusted.ton/malware.exe', 'xhr')).toBe(false)
      expect(manager.isBlocked('http://trusted.ton/modal.js', 'script')).toBe(false)
    })
  })

  describe('Master enable/disable toggle', () => {
    test('should allow all when disabled', () => {
      apply({ enabled: false })

      // Everything should be allowed
      expect(manager.isBlocked('http://example.ton/ads/banner.jpg', 'image')).toBe(false)
      expect(manager.isBlocked('http://example.ton/track/analytics.js', 'script')).toBe(false)
    })

    test('should respect filters when enabled', () => {
      apply({ enabled: true })

      // Filters should work
      expect(manager.isBlocked('http://example.ton/ads/banner.jpg', 'image')).toBe(true)
    })
  })
})
