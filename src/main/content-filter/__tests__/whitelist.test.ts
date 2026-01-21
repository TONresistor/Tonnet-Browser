/**
 * Tests for Content Filter Whitelist and Category Toggles
 */

import { ContentFilterManager } from '../filter-manager'

describe('ContentFilterManager - Whitelist', () => {
  let manager: ContentFilterManager

  beforeEach(() => {
    manager = new ContentFilterManager()
  })

  describe('Whitelist functionality', () => {
    test('should allow all requests from whitelisted domain', () => {
      manager.addToWhitelist('trusted.ton')

      // Test various resource types - all should be allowed
      expect(manager.isBlocked('http://trusted.ton/ads/banner.jpg', 'image')).toBe(false)
      expect(manager.isBlocked('http://trusted.ton/track/analytics.js', 'script')).toBe(false)
      expect(manager.isBlocked('http://trusted.ton/miner.js', 'script')).toBe(false)
    })

    test('should be case-insensitive', () => {
      manager.addToWhitelist('Trusted.TON')

      expect(manager.isBlocked('http://trusted.ton/ads/banner.jpg', 'image')).toBe(false)
      expect(manager.isBlocked('http://TRUSTED.TON/ads/banner.jpg', 'image')).toBe(false)
    })

    test('should handle subdomain whitelisting correctly', () => {
      manager.addToWhitelist('example.ton')

      // Should allow example.ton
      expect(manager.isBlocked('http://example.ton/ads/banner.jpg', 'image')).toBe(false)

      // Should NOT allow subdomain (unless explicitly whitelisted)
      expect(manager.isBlocked('http://sub.example.ton/ads/banner.jpg', 'image')).toBe(true)
    })

    test('should set whitelist from array', () => {
      manager.setWhitelist(['site1.ton', 'site2.ton', 'site3.ton'])

      expect(manager.isBlocked('http://site1.ton/ads/banner.jpg', 'image')).toBe(false)
      expect(manager.isBlocked('http://site2.ton/ads/banner.jpg', 'image')).toBe(false)
      expect(manager.isBlocked('http://site3.ton/ads/banner.jpg', 'image')).toBe(false)

      // Non-whitelisted should still be blocked
      expect(manager.isBlocked('http://other.ton/ads/banner.jpg', 'image')).toBe(true)
    })

    test('should replace entire whitelist when using setWhitelist', () => {
      manager.setWhitelist(['site1.ton', 'site2.ton'])
      manager.setWhitelist(['site3.ton'])

      // Old entries should be removed
      expect(manager.isBlocked('http://site1.ton/ads/banner.jpg', 'image')).toBe(true)
      expect(manager.isBlocked('http://site2.ton/ads/banner.jpg', 'image')).toBe(true)

      // New entry should work
      expect(manager.isBlocked('http://site3.ton/ads/banner.jpg', 'image')).toBe(false)
    })

    test('should remove domain from whitelist', () => {
      manager.addToWhitelist('trusted.ton')
      expect(manager.isBlocked('http://trusted.ton/ads/banner.jpg', 'image')).toBe(false)

      manager.removeFromWhitelist('trusted.ton')
      expect(manager.isBlocked('http://trusted.ton/ads/banner.jpg', 'image')).toBe(true)
    })

    test('should handle invalid URLs gracefully', () => {
      manager.addToWhitelist('trusted.ton')

      // Invalid URL should not crash
      expect(manager.isBlocked('not-a-url', 'script')).toBe(false) // Returns false if enabled but no match
    })
  })

  describe('Category toggles', () => {
    test('should block when category is enabled', () => {
      manager.setCategoryEnabled('ads', true)
      expect(manager.isBlocked('http://example.ton/ads/banner.jpg', 'image')).toBe(true)
    })

    test('should allow when category is disabled', () => {
      manager.setCategoryEnabled('ads', false)
      expect(manager.isBlocked('http://example.ton/ads/banner.jpg', 'image')).toBe(false)
    })

    test('should independently control each category', () => {
      manager.setCategoryEnabled('ads', true)
      manager.setCategoryEnabled('trackers', false)
      manager.setCategoryEnabled('miners', true)

      // Ads blocked
      expect(manager.isBlocked('http://example.ton/ads/banner.jpg', 'image')).toBe(true)

      // Trackers allowed
      expect(manager.isBlocked('http://example.ton/track/analytics.js', 'script')).toBe(false)

      // Miners blocked
      expect(manager.isBlocked('http://example.ton/coinhive.js', 'script')).toBe(true)
    })

    test('should respect category toggles for all categories', () => {
      const categories: Array<'ads' | 'trackers' | 'miners' | 'malware' | 'annoyances'> = [
        'ads',
        'trackers',
        'miners',
        'malware',
        'annoyances',
      ]

      // Disable all categories
      categories.forEach((cat) => manager.setCategoryEnabled(cat, false))

      // All should be allowed
      expect(manager.isBlocked('http://example.ton/ads/banner.jpg', 'image')).toBe(false)
      expect(manager.isBlocked('http://example.ton/track/analytics.js', 'script')).toBe(false)
      expect(manager.isBlocked('http://example.ton/coinhive.js', 'script')).toBe(false)
      expect(manager.isBlocked('http://example.ton/malware.exe', 'xhr')).toBe(false)
      expect(manager.isBlocked('http://example.ton/modal.js', 'script')).toBe(false)

      // Enable all categories
      categories.forEach((cat) => manager.setCategoryEnabled(cat, true))

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
      manager.addToWhitelist('trusted.ton')

      // Enable all categories
      manager.setCategoryEnabled('ads', true)
      manager.setCategoryEnabled('trackers', true)
      manager.setCategoryEnabled('miners', true)
      manager.setCategoryEnabled('malware', true)
      manager.setCategoryEnabled('annoyances', true)

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
      manager.setEnabled(false)

      // Everything should be allowed
      expect(manager.isBlocked('http://example.ton/ads/banner.jpg', 'image')).toBe(false)
      expect(manager.isBlocked('http://example.ton/track/analytics.js', 'script')).toBe(false)
    })

    test('should respect filters when enabled', () => {
      manager.setEnabled(true)

      // Filters should work
      expect(manager.isBlocked('http://example.ton/ads/banner.jpg', 'image')).toBe(true)
    })
  })

  describe('Statistics tracking', () => {
    test('should count whitelisted requests as allowed', () => {
      manager.addToWhitelist('trusted.ton')
      manager.resetStats()

      manager.isBlocked('http://trusted.ton/ads/banner.jpg', 'image')
      manager.isBlocked('http://trusted.ton/track/analytics.js', 'script')

      const stats = manager.getStats()
      expect(stats.totalAllowed).toBe(2)
      expect(stats.totalBlocked).toBe(0)
    })

    test('should not count blocked requests in category stats when category disabled', () => {
      manager.setCategoryEnabled('ads', false)
      manager.resetStats()

      manager.isBlocked('http://example.ton/ads/banner.jpg', 'image')

      const stats = manager.getStats()
      expect(stats.totalAllowed).toBe(1)
      expect(stats.totalBlocked).toBe(0)
      expect(stats.blockedByCategory.ads).toBe(0)
    })
  })
})
