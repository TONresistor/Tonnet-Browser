/**
 * Content Filter Manager for TON sites.
 * Blocks ads, trackers, miners, and malicious content on .ton domains.
 */

import { createLogger } from '../../shared/logger'
const log = createLogger('filter')
import type { ContentFilteringSettings } from '../../shared/types'
import { SUPPORTED_TLDS } from '../../shared/tlds'

export interface FilterRule {
  pattern: RegExp
  category: 'ads' | 'trackers' | 'miners' | 'malware' | 'annoyances'
  resourceTypes: Set<string>
  description: string
}

/**
 * Categories that only ever describe third-party resources. The rules below are
 * generic path heuristics, so on a first-party request they produce false
 * positives against ordinary API routes (e.g. /api/analytics/statistics/...).
 * Miners and malware stay enforced first-party: a compromised tonsite serving
 * a miner from its own origin is exactly the case worth blocking.
 */
const THIRD_PARTY_ONLY_CATEGORIES: ReadonlySet<FilterRule['category']> = new Set(['ads', 'trackers', 'annoyances'])

/** Registry suffixes that are never a site of their own, only a parent of one. */
const PUBLIC_SUFFIXES = new Set(SUPPORTED_TLDS.map((tld) => tld.slice(1)))

/** True when the request targets the site being browsed, or a subdomain of it. */
function isFirstParty(requestHost: string, firstPartyHost: string): boolean {
  if (!requestHost || !firstPartyHost) return false
  if (requestHost === firstPartyHost) return true
  // A shared registry suffix (ton, t.me) is not a common owner: every tonsite
  // ends with it, so matching on it would make the whole network first-party.
  if (requestHost.endsWith(`.${firstPartyHost}`)) return !PUBLIC_SUFFIXES.has(firstPartyHost)
  if (firstPartyHost.endsWith(`.${requestHost}`)) return !PUBLIC_SUFFIXES.has(requestHost)
  return false
}

export class ContentFilterManager {
  private rules: FilterRule[] = []
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
    this.loadDefaultRules()
    log.debug(`Loaded ${this.rules.length} filter rules`)
  }

  /**
   * Load TON-specific blocking patterns
   */
  private loadDefaultRules(): void {
    // ADVERTISEMENTS
    this.addRule({
      pattern: /\/(ads?|advert|banner|popup|sponsor)[/_\-.]/i,
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
      pattern: /\/(track|analytics|beacon|telemetry|stats|collect)[/_\-.]/i,
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
      pattern: /\/(miner|mining|cryptonight|webminer)[/_\-.]/i,
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
  }

  /**
   * Add a new filter rule
   */
  private addRule(rule: FilterRule): void {
    this.rules.push(rule)
  }

  /**
   * Check if URL should be blocked.
   *
   * `firstPartyHost` is the host of the top-level document the request belongs
   * to. When it is known, ad/tracker/annoyance rules are skipped for same-site
   * requests so a tonsite's own API and assets are never mistaken for trackers.
   */
  isBlocked(url: string, resourceType: string, firstPartyHost?: string | null): boolean {
    if (!this.enabled) {
      return false
    }

    // Check whitelist FIRST (bypass all filters)
    const domain = this.extractDomain(url)
    if (domain && this.whitelistedDomains.has(domain)) {
      log.debug(`Whitelisted: ${domain}`)
      return false
    }

    const firstParty = !!firstPartyHost && isFirstParty(domain, firstPartyHost.toLowerCase())

    // Check each rule
    for (const rule of this.rules) {
      // Check if category is enabled
      if (!this.categoryEnabled[rule.category]) {
        continue
      }

      // Third-party heuristics must not fire on the site's own resources
      if (firstParty && THIRD_PARTY_ONLY_CATEGORIES.has(rule.category)) {
        continue
      }

      // Check if resource type matches
      if (!rule.resourceTypes.has(resourceType)) {
        continue
      }

      // Check if pattern matches
      if (rule.pattern.test(url)) {
        log.debug(`Blocked [${rule.category}] ${resourceType}: ${url.substring(0, 100)}...`)
        return true
      }
    }

    return false
  }

  /**
   * Apply content filter settings from user preferences.
   * Syncs enabled state, whitelist, and per-category toggles.
   */
  applySettings(settings: ContentFilteringSettings): void {
    this.enabled = settings.enabled
    this.whitelistedDomains = new Set(settings.whitelistedDomains.map((d) => d.toLowerCase()))
    this.categoryEnabled = {
      ads: settings.blockAds,
      trackers: settings.blockTrackers,
      miners: settings.blockMiners,
      malware: settings.blockMalware,
      annoyances: settings.blockAnnoyances,
    }
    const cats = Object.entries(this.categoryEnabled)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(', ')
    log.debug(
      `Filter: ${this.enabled ? 'on' : 'off'}, whitelist: ${settings.whitelistedDomains.length}, categories: ${cats}`
    )
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

// Singleton removed: use ServiceRegistry from services.ts
