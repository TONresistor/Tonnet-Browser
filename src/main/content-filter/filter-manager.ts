/**
 * Content Filter Manager for TON sites.
 * Blocks ads, trackers, miners, and malicious content on .ton domains.
 */

import { EventEmitter } from 'events'
import { logger } from '../../shared/logger'

export interface FilterRule {
  pattern: RegExp
  category: 'ads' | 'trackers' | 'miners' | 'malware' | 'annoyances'
  resourceTypes: Set<string>
  description: string
}

export interface FilterStats {
  totalBlocked: number
  totalAllowed: number
  blockedByCategory: {
    ads: number
    trackers: number
    miners: number
    malware: number
    annoyances: number
  }
  sessionStarted: number
}

export class ContentFilterManager extends EventEmitter {
  private rules: FilterRule[] = []
  private stats: FilterStats = {
    totalBlocked: 0,
    totalAllowed: 0,
    blockedByCategory: {
      ads: 0,
      trackers: 0,
      miners: 0,
      malware: 0,
      annoyances: 0,
    },
    sessionStarted: Date.now(),
  }
  private enabled: boolean = true
  private whitelistedDomains: Set<string> = new Set()
  private categoryEnabled = {
    ads: true,
    trackers: true,
    miners: true,
    malware: true,
    annoyances: true,
  }

  constructor() {
    super()
    this.loadDefaultRules()
    logger.info('ContentFilter', `Loaded ${this.rules.length} filter rules`)
  }

  /**
   * Load TON-specific blocking patterns
   */
  private loadDefaultRules(): void {
    // ADVERTISEMENTS
    this.addRule({
      pattern: /\/(ads?|advert|banner|popup|sponsor)[\/_\-\.]/i,
      category: 'ads',
      resourceTypes: new Set(['image', 'script', 'stylesheet', 'xhr']),
      description: 'Advertisement resources',
    })

    this.addRule({
      pattern: /[._-]ad[._-]/i,
      category: 'ads',
      resourceTypes: new Set(['image', 'script']),
      description: 'Ad keyword in filename',
    })

    this.addRule({
      pattern: /\/promo\//i,
      category: 'ads',
      resourceTypes: new Set(['image', 'script', 'stylesheet']),
      description: 'Promotional content',
    })

    // TRACKERS & ANALYTICS
    this.addRule({
      pattern: /\/(track|analytics|beacon|telemetry|stats|collect)[\/_\-\.]/i,
      category: 'trackers',
      resourceTypes: new Set(['script', 'xhr', 'image']),
      description: 'Tracking and analytics',
    })

    this.addRule({
      pattern: /\/pixel\.(gif|png|jpg)/i,
      category: 'trackers',
      resourceTypes: new Set(['image']),
      description: 'Tracking pixel',
    })

    this.addRule({
      pattern: /[?&](utm_|ga_|fbclid|gclid|_ga|mc_)/i,
      category: 'trackers',
      resourceTypes: new Set(['script', 'xhr']),
      description: 'Tracking parameters',
    })

    this.addRule({
      pattern: /\/(fingerprint|device-id|visitor-id)/i,
      category: 'trackers',
      resourceTypes: new Set(['script', 'xhr']),
      description: 'Fingerprinting scripts',
    })

    // CRYPTOMINERS
    this.addRule({
      pattern: /(coinhive|crypto-loot|coin-hive|jsecoin)/i,
      category: 'miners',
      resourceTypes: new Set(['script']),
      description: 'Known mining services',
    })

    this.addRule({
      pattern: /\/(miner|mining|cryptonight|webminer)[\/_\-\.]/i,
      category: 'miners',
      resourceTypes: new Set(['script']),
      description: 'Mining scripts',
    })

    this.addRule({
      pattern: /\/worker.*mine/i,
      category: 'miners',
      resourceTypes: new Set(['script']),
      description: 'Mining web workers',
    })

    // MALWARE & SUSPICIOUS
    this.addRule({
      pattern: /\/(malware|virus|trojan|keylog|backdoor)/i,
      category: 'malware',
      resourceTypes: new Set(['script']),
      description: 'Malicious keywords',
    })

    this.addRule({
      pattern: /\.(exe|dll|bat|cmd|vbs|ps1|scr)$/i,
      category: 'malware',
      resourceTypes: new Set(['xhr', 'other']),
      description: 'Executable downloads',
    })

    // ANNOYANCES
    this.addRule({
      pattern: /\/(modal|overlay|interstitial|takeover)/i,
      category: 'annoyances',
      resourceTypes: new Set(['script', 'stylesheet']),
      description: 'Intrusive overlays',
    })

    this.addRule({
      pattern: /\/(notification|push-notify|subscribe-popup)/i,
      category: 'annoyances',
      resourceTypes: new Set(['script']),
      description: 'Push notification prompts',
    })

    logger.info('ContentFilter', `Default rules loaded: ${this.rules.length} patterns`)
  }

  /**
   * Add a new filter rule
   */
  private addRule(rule: FilterRule): void {
    this.rules.push(rule)
  }

  /**
   * Check if URL should be blocked
   */
  isBlocked(url: string, resourceType: string): boolean {
    if (!this.enabled) {
      this.stats.totalAllowed++
      return false
    }

    // Check whitelist FIRST (bypass all filters)
    const domain = this.extractDomain(url)
    if (domain && this.whitelistedDomains.has(domain)) {
      this.stats.totalAllowed++
      logger.debug('ContentFilter', `Whitelisted: ${domain}`)
      return false
    }

    // Check each rule
    for (const rule of this.rules) {
      // Check if category is enabled
      if (!this.categoryEnabled[rule.category]) {
        continue
      }

      // Check if resource type matches
      if (!rule.resourceTypes.has(resourceType)) {
        continue
      }

      // Check if pattern matches
      if (rule.pattern.test(url)) {
        // Blocked!
        this.stats.totalBlocked++
        this.stats.blockedByCategory[rule.category]++

        logger.debug(
          'ContentFilter',
          `Blocked [${rule.category}] ${resourceType}: ${url.substring(0, 100)}...`
        )

        // Emit event for UI updates
        this.emit('blocked', {
          url,
          resourceType,
          category: rule.category,
          description: rule.description,
          timestamp: Date.now(),
        })

        return true
      }
    }

    // Not blocked
    this.stats.totalAllowed++
    return false
  }

  /**
   * Get current statistics
   */
  getStats(): FilterStats {
    return { ...this.stats }
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalBlocked: 0,
      totalAllowed: 0,
      blockedByCategory: {
        ads: 0,
        trackers: 0,
        miners: 0,
        malware: 0,
        annoyances: 0,
      },
      sessionStarted: Date.now(),
    }
    logger.info('ContentFilter', 'Statistics reset')
  }

  /**
   * Enable/disable filtering
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    logger.info('ContentFilter', `Filtering ${enabled ? 'enabled' : 'disabled'}`)
  }

  /**
   * Check if filtering is enabled
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Get total rule count
   */
  getRuleCount(): number {
    return this.rules.length
  }

  /**
   * Set whitelist domains
   */
  setWhitelist(domains: string[]): void {
    this.whitelistedDomains = new Set(domains.map((d) => d.toLowerCase()))
    logger.info('ContentFilter', `Whitelist updated: ${domains.length} domains`)
  }

  /**
   * Add domain to whitelist
   */
  addToWhitelist(domain: string): void {
    this.whitelistedDomains.add(domain.toLowerCase())
    logger.info('ContentFilter', `Added to whitelist: ${domain}`)
  }

  /**
   * Remove domain from whitelist
   */
  removeFromWhitelist(domain: string): void {
    this.whitelistedDomains.delete(domain.toLowerCase())
    logger.info('ContentFilter', `Removed from whitelist: ${domain}`)
  }

  /**
   * Set category enabled/disabled
   */
  setCategoryEnabled(category: 'ads' | 'trackers' | 'miners' | 'malware' | 'annoyances', enabled: boolean): void {
    this.categoryEnabled[category] = enabled
    logger.info('ContentFilter', `Category ${category}: ${enabled ? 'enabled' : 'disabled'}`)
  }

  /**
   * Extract domain from URL
   */
  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname.toLowerCase()
    } catch {
      return ''
    }
  }
}

// Singleton instance
export const contentFilterManager = new ContentFilterManager()
