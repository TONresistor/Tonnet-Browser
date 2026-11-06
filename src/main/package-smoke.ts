import { app, type BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { ServiceRegistry } from './services'
import { runBookmarksScenario } from './bookmarks-runtime-tests'
import testContract from '../shared/packaged-test-contract.json'
import { getSetting } from './settings'
import { assertLivePage, type LivePageSnapshot } from './packaged-page-assertions'
import { runInternalRoutesSmoke } from './internal-routes-smoke'
import { runWalletScenario } from './wallet-runtime-tests'

interface PackageSmoke {
  profile: string
  suite: 'smoke' | 'bookmarks' | 'wallet' | 'storage'
  phase: string
  report: string
  url: string
  visible: boolean
}

/** Explicit local test invocation only; ordinary launches never enter this path. */
export function preparePackageSmoke(): PackageSmoke | null {
  const argument = (name: string): string | undefined =>
    process.argv
      .find((value) => value.startsWith(`--tonnet-package-smoke${name}=`))
      ?.split('=')
      .slice(1)
      .join('=')
  const profile = argument('')
  if (profile === undefined) return null
  assert(app.isPackaged, 'Package smoke must run the packaged application')
  assert(isAbsolute(profile), 'Package smoke requires an absolute disposable profile')
  assert(existsSync(join(profile, '.tonnet-package-smoke')), 'Disposable profile marker missing')
  assert.equal(realpathSync(profile), resolve(profile), 'Profile must not be a symlink')
  const suite = argument('-suite')
  assert(
    suite === 'smoke' || suite === 'bookmarks' || suite === 'wallet' || suite === 'storage',
    'Invalid package test suite'
  )
  const phase = argument('-phase')
  assert(phase && testContract.suites[suite].includes(phase), 'Invalid package smoke phase for suite')
  const report = argument('-report')
  assert(report && isAbsolute(report) && dirname(report) === profile, 'Report must be inside the disposable profile')
  assert(report === join(profile, `package-test-${phase}.json`), 'Report must use a dedicated package-test filename')
  assert.equal(argument('-version'), app.getVersion(), 'Packaged version does not match the expected release')
  const url = argument('-url')
  assert(url, 'Local navigation fixture missing')
  const parsed = new URL(url)
  assert(url === 'http://manifesto.ton/', 'Live smoke target must be manifesto.ton')
  assert(!parsed.username && !parsed.password, 'Fixture must not contain credentials')
  // Chromium cookie encryption otherwise reaches the real macOS Keychain even
  // with a fresh profile. This switch is confined to the validated smoke invocation.
  if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain')
  if (process.platform === 'linux' && suite === 'wallet')
    app.commandLine.appendSwitch('password-store', 'gnome-libsecret')
  app.setPath('userData', profile)
  // Electron defaults sessionData to userData, but bind it explicitly before readiness.
  app.setPath('sessionData', profile)
  const logs = join(profile, 'logs')
  mkdirSync(logs, { recursive: true, mode: 0o700 })
  app.setPath('logs', logs)
  const visible = process.argv.includes('--tonnet-package-smoke-visible') && !process.env.CI
  return { profile, suite, phase, report, url, visible }
}

async function until(check: () => Promise<boolean> | boolean, label: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await check())) {
    assert(Date.now() < deadline, `Timed out: ${label}`)
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  }
}

/** Real packaged flow: internal pages, Manifesto, Piracy in a second tab, then favorites. */
export async function runPackageSmoke(
  config: PackageSmoke,
  window: BrowserWindow,
  services: ServiceRegistry
): Promise<void> {
  window.webContents.setBackgroundThrottling(false)
  const checks: string[] = []
  let internalRoutes: string[] = []
  const pass = (message: string): void => {
    checks.push(message)
    process.stdout.write(`PASS ${config.suite}/${config.phase}: ${message}\n`)
  }
  try {
    if (!config.visible)
      window.on('show', () => {
        throw new Error('CI smoke must stay invisible')
      })
    await until(
      async () =>
        !window.webContents.isLoading() &&
        (await window.webContents.executeJavaScript(
          "Boolean(document.getElementById('root')?.childElementCount && window.electron?.proxy)"
        )),
      'landing page ready'
    )
    if (config.visible) {
      assert(window.isVisible(), 'Browser must be visible from startup')
      window.focus()
    }
    pass('packaged browser started with a disposable profile')
    if (config.visible) await new Promise((resolvePause) => setTimeout(resolvePause, 2000))
    await until(
      () =>
        window.webContents.executeJavaScript(
          "Boolean(document.querySelector('[data-testid=ton-connect-button]:not(:disabled)'))"
        ),
      'Connect button ready'
    )
    const clicked = await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('[data-testid=ton-connect-button]');
    if (!button || button.disabled) return false;
    button.click(); return true;
  })()`)
    assert(clicked, 'Connect button missing or disabled')
    pass('Connect clicked on the real landing screen')
    const connectionDeadline = Date.now() + 180_000
    while (services.proxyManager.getStatus().status !== 'connected' || !services.storageManager.getStatus().running) {
      assert(Date.now() < connectionDeadline, 'TON connection timed out after 180 seconds')
      await new Promise((resolveWait) => setTimeout(resolveWait, 250))
    }
    assert(services.proxyManager.isRunning(), 'Connected status without a running proxy')
    assert(services.storageManager.getStatus().running, 'Storage daemon did not start')
    pass('real TON proxy connected and Storage running')
    await until(
      () => window.webContents.executeJavaScript("Boolean(document.getElementById('address-bar-input'))"),
      'connected browser address bar'
    )
    const submit = async (url: string): Promise<void> => {
      await window.webContents.executeJavaScript(`(() => {
        const input = document.getElementById('address-bar-input');
        input.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(url)});
        input.dispatchEvent(new Event('input', {bubbles:true}));
      })()`)
      await new Promise((resolveWait) => setTimeout(resolveWait, 50))
      await window.webContents.executeJavaScript(
        "document.getElementById('address-bar-input').closest('form').requestSubmit()",
        true
      )
    }
    if (config.phase === 'live') {
      const chromeClick = async (selector: string): Promise<void> => {
        await until(
          () => window.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),
          `button ready: ${selector}`
        )
        const clicked = await window.webContents.executeJavaScript(
          `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element || element.disabled) return false;
      element.click(); return true;
    })()`,
          true
        )
        assert(clicked, `Control unavailable: ${selector}`)
      }
      const pageSnapshot = async () => {
        const view = services.tabManager.getActiveView()
        if (!view || view.webContents.isLoading() || !window.contentView.children.includes(view)) return null
        return view.webContents
          .executeJavaScript(
            "({url: location.href, title: document.title, text: document.body?.innerText.replace(/\\s+/g, ' ').trim() ?? '', headings:Array.from(document.querySelectorAll('h1,h2'),h=>h.textContent.trim()),formCount:document.querySelectorAll('form').length,links:Array.from(document.querySelectorAll('a[href]'),a=>a.href), identity: [document.title, document.querySelector('h1,h2')?.textContent?.trim() ?? '', document.querySelector('meta[name=description]')?.content ?? ''].join('\\n')})"
          )
          .catch(() => null) as Promise<(LivePageSnapshot & { identity: string }) | null>
      }
      const waitPage = async (url: string, expectedIdentity?: string) => {
        const expected = new URL(url)
        let snapshot: (LivePageSnapshot & { identity: string }) | null = null
        try {
          await until(
            async () => {
              snapshot = await pageSnapshot()
              return Boolean(
                snapshot &&
                new URL(snapshot.url).origin === expected.origin &&
                new URL(snapshot.url).pathname.replace(/\/$/, '') === expected.pathname.replace(/\/$/, '') &&
                new URL(snapshot.url).search === expected.search &&
                new URL(snapshot.url).hash === expected.hash &&
                snapshot.text.length > 0 &&
                (!expectedIdentity || snapshot.identity === expectedIdentity)
              )
            },
            `visible page content at ${url}`,
            120_000
          )
        } catch (error) {
          const view = services.tabManager.getActiveView()
          process.stdout.write(
            `FAIL navigation: expected ${url}; actual ${JSON.stringify({ url: view?.webContents.getURL(), loading: view?.webContents.isLoading(), attached: view ? window.contentView.children.includes(view) : false, snapshot })}\n`
          )
          throw error
        }
        assert(snapshot)
        assertLivePage(snapshot, url)
        return snapshot as LivePageSnapshot & { identity: string }
      }
      internalRoutes = await runInternalRoutesSmoke({ window, services, profile: config.profile, submit, pass })
      const firstTabId = services.tabManager.getActiveTabId()
      assert(firstTabId, 'Original tab missing')
      const initialTabCount = await window.webContents.executeJavaScript(
        "document.querySelectorAll('[role=tab]').length"
      )
      await submit(config.url)
      const manifestoPage = await waitPage(config.url)
      assert.deepEqual(
        await services.tabManager
          .getActiveView()!
          .webContents.executeJavaScript('({node:typeof require,privileged:typeof window.electron})'),
        { node: 'undefined', privileged: 'undefined' }
      )
      pass(`step 1: manifesto.ton rendered in the first tab: ${manifestoPage.title}`)
      await chromeClick('[data-testid=browser-new-tab]')
      await until(
        async () =>
          services.tabManager.getActiveTabId() !== firstTabId &&
          (await window.webContents.executeJavaScript("document.querySelectorAll('[role=tab]').length")) ===
            initialTabCount + 1,
        'second tab selected'
      )
      const secondTabId = services.tabManager.getActiveTabId()
      assert(secondTabId)
      await submit('http://piracy.ton/')
      let navigationHome: Awaited<ReturnType<typeof pageSnapshot>> = null
      await until(
        async () => {
          navigationHome = await pageSnapshot()
          return Boolean(
            navigationHome && new URL(navigationHome.url).hostname === 'piracy.ton' && navigationHome.text.length > 200
          )
        },
        'piracy.ton navigation homepage',
        120_000
      )
      assert(navigationHome)
      const firstPage = navigationHome as NonNullable<Awaited<ReturnType<typeof pageSnapshot>>>
      assertLivePage(firstPage, 'http://piracy.ton/')
      pass('step 2: piracy.ton navigation homepage loaded')
      const firstView = services.tabManager.getActiveView()!
      const nextUrl = await firstView.webContents.executeJavaScript(
        `document.querySelector('a[href="/add.html"]')?.href ?? null`
      )
      assert(nextUrl, 'piracy.ton has no same-site link suitable for the navigation flow')
      assert.equal(new URL(nextUrl).hostname, 'piracy.ton')
      pass(`step 2: existing internal link selected ${nextUrl}`)
      await firstView.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('a[href]')).find(link => link.href === ${JSON.stringify(nextUrl)}).click()`,
        true
      )
      const secondPage = await waitPage(nextUrl)
      assert.equal(services.tabManager.getActiveTabId(), secondTabId, 'Internal link unexpectedly changed tabs')
      pass(`step 2: actual internal link loaded ${nextUrl}`)
      await chromeClick('[data-testid=browser-back]:not(:disabled)')
      await waitPage(firstPage.url, firstPage.identity)
      pass('step 2: Back restored the original URL and content')
      await chromeClick('[data-testid=browser-forward]:not(:disabled)')
      await waitPage(secondPage.url, secondPage.identity)
      pass('step 2: Forward restored the linked URL and content')
      const reloadContents = services.tabManager.getActiveView()!.webContents
      let reloading = false
      let reloaded = false
      const onReloadStart = () => {
        reloading = true
      }
      const onReloadFinish = () => {
        reloaded = true
      }
      reloadContents.on('did-start-loading', onReloadStart)
      reloadContents.on('did-finish-load', onReloadFinish)
      try {
        await chromeClick('[data-testid=browser-reload]')
        await until(() => reloading && reloaded, 'real document reload completed', 120_000)
        await waitPage(secondPage.url, secondPage.identity)
      } finally {
        reloadContents.removeListener('did-start-loading', onReloadStart)
        reloadContents.removeListener('did-finish-load', onReloadFinish)
      }
      pass('step 2: Reload performed a document load and preserved URL/content')
      const selectTab = async (id: string) => {
        const selected = await window.webContents.executeJavaScript(`(() => {
      const tab = Array.from(document.querySelectorAll('[role=tab]')).find(tab => tab.dataset.tabId === ${JSON.stringify(id)});
      if (!tab) return false;
      tab.click(); return true;
    })()`)
        assert(selected, `Tab missing: ${id}`)
        await until(
          async () =>
            services.tabManager.getActiveTabId() === id &&
            (await window.webContents.executeJavaScript(
              `Array.from(document.querySelectorAll('[role=tab]')).find(tab => tab.dataset.tabId === ${JSON.stringify(id)})?.getAttribute('aria-selected') === 'true'`
            )),
          'tab active in chrome and main process'
        )
      }
      await selectTab(firstTabId)
      await waitPage(manifestoPage.url, manifestoPage.identity)
      await selectTab(secondTabId)
      await waitPage(secondPage.url, secondPage.identity)
      pass('step 3: switching tabs restored each independent URL and content')
      const closedContents = services.tabManager.getActiveView()!.webContents
      const closing = await window.webContents.executeJavaScript(`(() => {
    const tab = Array.from(document.querySelectorAll('[role=tab]')).find(tab => tab.dataset.tabId === ${JSON.stringify(secondTabId)});
    const close = tab?.querySelector('[data-testid=browser-close-tab]');
    if (!close) return false;
    close.click(); return true;
  })()`)
      assert(closing, 'Active tab close control missing')
      await until(
        async () =>
          closedContents.isDestroyed() &&
          !services.tabManager.hasTab(secondTabId) &&
          services.tabManager.getActiveTabId() === firstTabId &&
          (await window.webContents.executeJavaScript("document.querySelectorAll('[role=tab]').length")) ===
            initialTabCount,
        'closed tab disposed and remaining tab selected'
      )
      await waitPage(manifestoPage.url, manifestoPage.identity)
      pass('step 3: closing Piracy destroyed its view and restored Manifesto in the first tab')
    }
    if (config.suite === 'wallet') {
      await services.walletManager.init()
      await runWalletScenario({ window, profile: config.profile, phase: config.phase, pass })
    } else if (config.suite === 'storage') {
      internalRoutes = await runInternalRoutesSmoke({
        window,
        services,
        profile: config.profile,
        submit,
        pass,
        onlyStorageRemoval: true,
      })
    } else {
      assert(getSetting('privacy').clearOnExit, 'Package tests must exercise clear-on-exit with preserved bookmarks')
      await runBookmarksScenario({
        window,
        services,
        profile: config.profile,
        phase: config.phase === 'live' ? 'smoke' : config.phase,
        pass,
      })
    }
    if (!config.visible) assert(!window.isVisible(), 'Invisible live flow displayed a window')
    if (config.visible) await new Promise((resolvePause) => setTimeout(resolvePause, 2000))
    await window.webContents.executeJavaScript('window.electron.proxy.disconnect()')
    assert(!services.proxyManager.isRunning(), 'Proxy still running after disconnect')
    assert(!services.storageManager.getStatus().running, 'Storage still running after disconnect')
    await until(
      () => window.webContents.executeJavaScript("document.querySelectorAll('[role=tab]').length === 0"),
      'disconnected browser UI committed'
    )
    // React's passive cleanup effects can send overlay IPC after the status
    // event commits. Drain two rendering frames while handlers still exist.
    await window.webContents.executeJavaScript(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
    )
    pass('test proxy and Storage disconnected cleanly; renderer cleanup effects drained')
    await writeFile(
      config.report,
      JSON.stringify(
        {
          ok: true,
          packaged: app.isPackaged,
          version: app.getVersion(),
          phase: config.phase,
          checks,
          internalRoutes,
          scenario: testContract.scenario,
          suite: config.suite,
        },
        null,
        2
      )
    )
    app.quit()
  } catch (error) {
    const failure = {
      ok: false,
      packaged: app.isPackaged,
      version: app.getVersion(),
      suite: config.suite,
      phase: config.phase,
      scenario: testContract.scenario,
      checks,
      internalRoutes,
      error: { message: error instanceof Error ? error.message : String(error) },
    }
    await writeFile(config.report, JSON.stringify(failure, null, 2)).catch(() => {})
    if (!window.isDestroyed()) {
      await window
        .capturePage()
        .then((image) => writeFile(join(config.profile, `${config.phase}-failure.png`), image.toPNG()))
        .catch(() => {})
    }
    throw error
  }
}
