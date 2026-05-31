/**
 * Content Filter Manager tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ContentFilterManager } from '../filter-manager'

const ALL_ENABLED = {
  enabled: true,
  blockAds: true,
  blockTrackers: true,
  blockMiners: true,
  blockMalware: true,
  blockAnnoyances: true,
  whitelistedDomains: [] as string[],
}

describe('ContentFilterManager', () => {
  let filter: ContentFilterManager

  beforeEach(() => {
    filter = new ContentFilterManager()
  })

  describe('Advertisement blocking', () => {
    it('should block /ads/ URLs', () => {
      expect(filter.isBlocked('http://site.ton/ads/banner.jpg', 'image')).toBe(true)
    })

    it('should block /advert/ URLs', () => {
      expect(filter.isBlocked('http://site.ton/advert/promo.js', 'script')).toBe(true)
    })

    it('should block /banner/ URLs', () => {
      expect(filter.isBlocked('http://site.ton/banner/top.png', 'image')).toBe(true)
    })

    it('should block ad keyword in filename', () => {
      expect(filter.isBlocked('http://site.ton/images/promo_ad_large.jpg', 'image')).toBe(true)
    })

    it('should block /promo/ URLs', () => {
      expect(filter.isBlocked('http://site.ton/promo/offer.html', 'script')).toBe(true)
    })
  })

  describe('Tracker blocking', () => {
    it('should block /track/ URLs', () => {
      expect(filter.isBlocked('http://site.ton/track/event.js', 'script')).toBe(true)
    })

    it('should block /analytics/ URLs', () => {
      expect(filter.isBlocked('http://site.ton/analytics.js', 'script')).toBe(true)
    })

    it('should block tracking pixels', () => {
      expect(filter.isBlocked('http://site.ton/pixel.gif', 'image')).toBe(true)
      expect(filter.isBlocked('http://site.ton/tracking/pixel.png', 'image')).toBe(true)
    })

    it('should block URLs with tracking parameters', () => {
      expect(filter.isBlocked('http://site.ton/page?utm_source=email', 'xhr')).toBe(true)
      expect(filter.isBlocked('http://site.ton/api?ga_session=123', 'script')).toBe(true)
      expect(filter.isBlocked('http://site.ton/link?fbclid=abc123', 'xhr')).toBe(true)
    })

    it('should block fingerprinting scripts', () => {
      expect(filter.isBlocked('http://site.ton/fingerprint.js', 'script')).toBe(true)
      expect(filter.isBlocked('http://site.ton/device-id/collect.js', 'script')).toBe(true)
    })
  })

  describe('Cryptominer blocking', () => {
    it('should block known mining services', () => {
      expect(filter.isBlocked('http://coinhive.ton/lib/miner.js', 'script')).toBe(true)
      expect(filter.isBlocked('http://site.ton/crypto-loot.js', 'script')).toBe(true)
    })

    it('should block /miner/ URLs', () => {
      expect(filter.isBlocked('http://site.ton/scripts/miner.js', 'script')).toBe(true)
      expect(filter.isBlocked('http://site.ton/mining/worker.js', 'script')).toBe(true)
    })

    it('should block mining workers', () => {
      expect(filter.isBlocked('http://site.ton/worker.mine.js', 'script')).toBe(true)
    })
  })

  describe('Malware blocking', () => {
    it('should block malicious keywords', () => {
      expect(filter.isBlocked('http://site.ton/malware.js', 'script')).toBe(true)
      expect(filter.isBlocked('http://site.ton/keylog/capture.js', 'script')).toBe(true)
    })

    it('should block executable downloads', () => {
      expect(filter.isBlocked('http://site.ton/download.exe', 'xhr')).toBe(true)
      expect(filter.isBlocked('http://site.ton/files/tool.bat', 'other')).toBe(true)
      expect(filter.isBlocked('http://site.ton/setup.vbs', 'xhr')).toBe(true)
    })
  })

  describe('Annoyance blocking', () => {
    it('should block modal/overlay scripts', () => {
      expect(filter.isBlocked('http://site.ton/modal/popup.js', 'script')).toBe(true)
      expect(filter.isBlocked('http://site.ton/overlay.js', 'script')).toBe(true)
    })

    it('should block push notification prompts', () => {
      expect(filter.isBlocked('http://site.ton/notification/prompt.js', 'script')).toBe(true)
      expect(filter.isBlocked('http://site.ton/push-notify.js', 'script')).toBe(true)
    })
  })

  describe('Allowed content', () => {
    it('should allow clean HTML pages', () => {
      expect(filter.isBlocked('http://site.ton/index.html', 'document')).toBe(false)
      expect(filter.isBlocked('http://site.ton/about.html', 'document')).toBe(false)
    })

    it('should allow legitimate scripts', () => {
      expect(filter.isBlocked('http://site.ton/app.js', 'script')).toBe(false)
      expect(filter.isBlocked('http://site.ton/main.js', 'script')).toBe(false)
    })

    it('should allow legitimate images', () => {
      expect(filter.isBlocked('http://site.ton/logo.png', 'image')).toBe(false)
      expect(filter.isBlocked('http://site.ton/content/photo.jpg', 'image')).toBe(false)
    })

    it('should allow legitimate stylesheets', () => {
      expect(filter.isBlocked('http://site.ton/style.css', 'stylesheet')).toBe(false)
      expect(filter.isBlocked('http://site.ton/theme.css', 'stylesheet')).toBe(false)
    })
  })

  describe('Resource type filtering', () => {
    it('should only block matching resource types', () => {
      // /ads/ pattern blocks image, script, stylesheet, xhr
      expect(filter.isBlocked('http://site.ton/ads/banner.jpg', 'image')).toBe(true)
      expect(filter.isBlocked('http://site.ton/ads/tracker.js', 'script')).toBe(true)
      expect(filter.isBlocked('http://site.ton/ads/style.css', 'stylesheet')).toBe(true)

      // But not document type (main frame)
      expect(filter.isBlocked('http://site.ton/ads/page.html', 'document')).toBe(false)
    })
  })

  describe('Enable/disable', () => {
    it('should allow everything when disabled', () => {
      filter.applySettings({ ...ALL_ENABLED, enabled: false })

      expect(filter.isBlocked('http://site.ton/ads/banner.jpg', 'image')).toBe(false)
      expect(filter.isBlocked('http://site.ton/track.js', 'script')).toBe(false)
      expect(filter.isBlocked('http://site.ton/miner.js', 'script')).toBe(false)
    })

    it('should block when re-enabled', () => {
      filter.applySettings({ ...ALL_ENABLED, enabled: false })
      filter.applySettings({ ...ALL_ENABLED, enabled: true })

      expect(filter.isBlocked('http://site.ton/ads/banner.jpg', 'image')).toBe(true)
    })
  })
})
