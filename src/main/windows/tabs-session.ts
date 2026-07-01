/**
 * Session management for first-party isolation and cookie auto-delete.
 * Extracted from tabs.ts to separate domain session lifecycle from tab lifecycle.
 */

import { SESSION_PARTITION } from './constants'
import { createTonSession } from './browser-view'
import { getSetting, type PrivacySettings } from '../settings'
import { createLogger } from '../../shared/logger'

const log = createLogger('tabs-session')

// Map of sessions by domain (for first-party isolation)
const domainSessions = new Map<string, Electron.Session>()
// Map of tab IDs to their current domain
const tabDomains = new Map<string, string>()
// Map of domain to last activity timestamp (for cookie auto-delete)
const domainActivity = new Map<string, number>()
let tonSession: Electron.Session | null = null
let cookieAutoDeleteTimer: NodeJS.Timeout | null = null

// --- Domain helpers ---

export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.hostname
  } catch {
    return 'default'
  }
}

export function getTabDomain(tabId: string): string | undefined {
  return tabDomains.get(tabId)
}

export function setTabDomain(tabId: string, domain: string): void {
  tabDomains.set(tabId, domain)
}

// --- Domain activity tracking ---

export function updateDomainActivity(domain: string): void {
  domainActivity.set(domain, Date.now())

  // Restart cookie auto-delete timer if not already running (handles idle->active transition)
  const privacy: PrivacySettings = getSetting('privacy')
  const cookieAutoDelete = privacy.cookieAutoDelete ?? false
  if (cookieAutoDelete && !cookieAutoDeleteTimer) {
    startCookieAutoDeleteTimer()
  }
}

// --- Cookie auto-delete ---

/**
 * Wipe every storage bucket AND the HTTP cache for a domain session. The cache
 * and cachestorage were previously left behind, so a domain's on-disk cache
 * survived eviction indefinitely (never reached by clearOnExit either).
 */
async function purgeSessionData(session: Electron.Session): Promise<void> {
  await session.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage'],
  })
  await session.clearCache()
}

async function checkInactiveDomains(): Promise<void> {
  const privacy: PrivacySettings = getSetting('privacy')
  const cookieAutoDelete = privacy.cookieAutoDelete ?? false
  const cookieAutoDeleteMinutes = privacy.cookieAutoDeleteMinutes ?? 30

  if (!cookieAutoDelete) return

  const now = Date.now()
  const inactiveThreshold = cookieAutoDeleteMinutes * 60 * 1000

  // Get domains that are currently in use (have open tabs)
  const activeDomains = new Set(tabDomains.values())

  for (const [domain, lastActivity] of domainActivity.entries()) {
    if (activeDomains.has(domain)) continue

    if (now - lastActivity > inactiveThreshold) {
      const session = domainSessions.get(domain)
      if (session) {
        log.info(`Auto-deleting cookies for inactive domain: ${domain}`)
        try {
          await purgeSessionData(session)
          domainActivity.delete(domain)
          domainSessions.delete(domain)
        } catch (error) {
          log.error(`Failed to clear storage for ${domain}:`, error)
        }
      }
    }
  }

  // Stop timer if no more domains to monitor
  if (domainActivity.size === 0 && cookieAutoDeleteTimer) {
    clearInterval(cookieAutoDeleteTimer)
    cookieAutoDeleteTimer = null
    log.debug('Cookie auto-delete timer stopped (no domains to monitor)')
  }
}

function startCookieAutoDeleteTimer(): void {
  if (cookieAutoDeleteTimer) {
    clearInterval(cookieAutoDeleteTimer)
  }

  const privacy: PrivacySettings = getSetting('privacy')
  const cookieAutoDelete = privacy.cookieAutoDelete ?? false

  if (!cookieAutoDelete) return
  if (domainActivity.size === 0) return

  cookieAutoDeleteTimer = setInterval(() => {
    checkInactiveDomains().catch((error) => {
      log.error('Cookie auto-delete check failed:', error)
    })
  }, 60000)
}

export function onPrivacySettingsChanged(): void {
  startCookieAutoDeleteTimer()
}

export function initCookieAutoDelete(): void {
  startCookieAutoDeleteTimer()
}

// --- Session management (first-party isolation) ---

export async function getSessionForDomain(domain: string, proxyPort: number): Promise<Electron.Session> {
  const privacy: PrivacySettings = getSetting('privacy')
  const firstPartyIsolation = privacy.firstPartyIsolation ?? true

  if (!firstPartyIsolation) {
    if (!tonSession) {
      tonSession = await createTonSession(proxyPort, SESSION_PARTITION)
    }
    return tonSession
  }

  if (domainSessions.has(domain)) {
    updateDomainActivity(domain)
    return domainSessions.get(domain)!
  }

  const partitionName = `persist:ton-domain-${domain}`
  const session = await createTonSession(proxyPort, partitionName)
  domainSessions.set(domain, session)
  updateDomainActivity(domain)

  log.debug(`Created isolated session for domain: ${domain}`)
  return session
}

/**
 * Clean up domain session when a tab is closed.
 * Removes the session if no other tab uses the same domain.
 */
export function cleanupDomainForTab(tabId: string): void {
  const domain = tabDomains.get(tabId)
  tabDomains.delete(tabId)
  if (domain) {
    const domainStillInUse = [...tabDomains.values()].includes(domain)
    if (!domainStillInUse) {
      const session = domainSessions.get(domain)
      if (session) {
        purgeSessionData(session).catch((err) => log.error(`Failed to clear storage for ${domain}:`, err))
      }
      domainSessions.delete(domain)
      domainActivity.delete(domain)
    }
  }
}

export function getAllSessions(): Electron.Session[] {
  const sessions: Electron.Session[] = []
  if (tonSession) {
    sessions.push(tonSession)
  }
  domainSessions.forEach((session) => {
    sessions.push(session)
  })
  return sessions
}
