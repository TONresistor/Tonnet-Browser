/** Instance-owned browser session isolation and cookie-retention lifecycle. */
import { SESSION_PARTITION } from './constants'
import { createTonSession, type SessionDeps } from './browser-view'
import { getSetting, type PrivacySettings } from '../settings'
import { createLogger, RepetitionAggregator } from '../../shared/logger'

const log = createLogger('tabs-session')

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return 'default'
  }
}

async function purgeSessionCookies(session: Electron.Session, domain: string, shared: boolean): Promise<void> {
  if (!shared) {
    await session.clearStorageData({ storages: ['cookies'] })
    return
  }
  const cookies = await session.cookies.get({ domain })
  await Promise.all(
    cookies.map((cookie) => {
      const host = (cookie.domain || domain).replace(/^\./, '')
      const path = cookie.path?.startsWith('/') ? cookie.path : '/'
      return session.cookies.remove(`${cookie.secure ? 'https' : 'http'}://${host}${path}`, cookie.name)
    })
  )
}

function partitionForIdentity(identity: string): string {
  if (identity.startsWith('bag:')) return `persist:ton-bag-${identity.slice(4).toLowerCase()}`
  return `persist:ton-domain-${identity}`
}

export class TabSessionManager {
  private readonly domainSessions = new Map<string, Electron.Session>()
  private readonly tabDomains = new Map<string, string>()
  private readonly domainActivity = new Map<string, number>()
  private tonSession: Electron.Session | null = null
  private cookieAutoDeleteTimer: NodeJS.Timeout | null = null
  private deps: SessionDeps | null = null
  private readonly purgeFailures = new RepetitionAggregator(log)

  getTabDomain(tabId: string): string | undefined {
    return this.tabDomains.get(tabId)
  }

  setTabDomain(tabId: string, domain: string): void {
    this.tabDomains.set(tabId, domain)
  }

  updateDomainActivity(domain: string): void {
    this.domainActivity.set(domain, Date.now())
    const privacy: PrivacySettings = getSetting('privacy')
    if ((privacy.cookieAutoDelete ?? false) && !this.cookieAutoDeleteTimer) this.startCookieAutoDeleteTimer()
  }

  onPrivacySettingsChanged(settings?: PrivacySettings): void {
    this.startCookieAutoDeleteTimer(settings)
  }

  initialize(deps: SessionDeps): void {
    this.deps = deps
    this.startCookieAutoDeleteTimer()
  }

  detachWindow(): void {
    this.tabDomains.clear()
  }

  async getSessionForDomain(
    domain: string,
    proxyPort: number,
    firstPartyIsolation = getSetting('privacy').firstPartyIsolation ?? true
  ): Promise<Electron.Session> {
    if (!this.deps) throw new Error('Tab session manager is not initialized.')
    if (!firstPartyIsolation) {
      this.tonSession ??= await createTonSession(this.deps, proxyPort, SESSION_PARTITION)
      return this.tonSession
    }

    const existing = this.domainSessions.get(domain)
    if (existing) {
      this.updateDomainActivity(domain)
      return existing
    }

    const session = await createTonSession(
      this.deps,
      proxyPort,
      partitionForIdentity(domain),
      domain.startsWith('bag:') ? null : domain.toLowerCase()
    )
    this.domainSessions.set(domain, session)
    this.updateDomainActivity(domain)
    log.debug(`Created isolated session for domain: ${domain}`)
    return session
  }

  async updateProxyPort(proxyPort: number): Promise<void> {
    await Promise.all(
      this.getAllSessions().map(async (session) => {
        await session.setProxy({ proxyRules: `http://127.0.0.1:${proxyPort}` })
        await session.closeAllConnections()
      })
    )
  }

  cleanupDomainForTab(tabId: string): void {
    const domain = this.tabDomains.get(tabId)
    this.tabDomains.delete(tabId)
    if (!domain || [...this.tabDomains.values()].includes(domain)) return
    this.domainActivity.set(domain, Date.now())
    const privacy: PrivacySettings = getSetting('privacy')
    if (privacy.cookieAutoDelete ?? false) this.startCookieAutoDeleteTimer(privacy)
  }

  getAllSessions(): Electron.Session[] {
    return [...(this.tonSession ? [this.tonSession] : []), ...this.domainSessions.values()]
  }

  dispose(): void {
    if (this.cookieAutoDeleteTimer) clearInterval(this.cookieAutoDeleteTimer)
    this.cookieAutoDeleteTimer = null
    this.tabDomains.clear()
    this.domainActivity.clear()
    this.domainSessions.clear()
    this.tonSession = null
    this.deps = null
  }

  private startCookieAutoDeleteTimer(settings?: PrivacySettings): void {
    if (this.cookieAutoDeleteTimer) clearInterval(this.cookieAutoDeleteTimer)
    this.cookieAutoDeleteTimer = null
    const privacy: PrivacySettings = settings ?? getSetting('privacy')
    if (!(privacy.cookieAutoDelete ?? false) || this.domainActivity.size === 0) return
    this.cookieAutoDeleteTimer = setInterval(() => {
      void this.checkInactiveDomains().catch((error) =>
        this.purgeFailures.record('timer', 'privacy.cookie_cleanup.failed', 'cookie cleanup failed', { error })
      )
    }, 60_000)
  }

  private async checkInactiveDomains(): Promise<void> {
    const privacy: PrivacySettings = getSetting('privacy')
    if (!(privacy.cookieAutoDelete ?? false)) return
    const inactiveThreshold = (privacy.cookieAutoDeleteMinutes ?? 30) * 60_000
    const now = Date.now()
    const activeDomains = new Set(this.tabDomains.values())

    for (const [domain, lastActivity] of this.domainActivity) {
      if (activeDomains.has(domain) || now - lastActivity <= inactiveThreshold) continue
      const session = this.domainSessions.get(domain) ?? this.tonSession
      if (!session) continue
      try {
        const shared = session === this.tonSession
        await purgeSessionCookies(session, domain, shared)
        this.purgeFailures.recovered(domain, 'privacy.session_purge.restored', 'session purge restored')
        this.domainActivity.delete(domain)
        if (!shared) this.domainSessions.delete(domain)
      } catch (error) {
        this.purgeFailures.record(domain, 'privacy.session_purge.failed', 'session purge failed', { error })
      }
    }

    this.purgeFailures.recovered('timer', 'privacy.cookie_cleanup.restored', 'cookie cleanup restored')

    if (this.domainActivity.size === 0 && this.cookieAutoDeleteTimer) {
      clearInterval(this.cookieAutoDeleteTimer)
      this.cookieAutoDeleteTimer = null
    }
  }
}
