import { app, type BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { ServiceRegistry } from './services'

interface PackageSmoke {
  profile: string
  phase: 'live'
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
  const phase = argument('-phase')
  assert(phase === 'live', 'Invalid package smoke phase')
  const report = argument('-report')
  assert(report && isAbsolute(report) && dirname(report) === profile, 'Report must be inside the disposable profile')
  assert.equal(argument('-version'), app.getVersion(), 'Packaged version does not match the expected release')
  const url = argument('-url')
  assert(url, 'Local navigation fixture missing')
  const parsed = new URL(url)
  assert(url === 'http://manifesto.ton/', 'Live smoke target must be manifesto.ton')
  assert(!parsed.username && !parsed.password, 'Fixture must not contain credentials')
  // Chromium cookie encryption otherwise reaches the real macOS Keychain even
  // with a fresh profile. This switch is confined to the validated smoke invocation.
  if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain')
  app.setPath('userData', profile)
  // Electron defaults sessionData to userData, but bind it explicitly before readiness.
  app.setPath('sessionData', profile)
  const logs = join(profile, 'logs')
  mkdirSync(logs, { recursive: true, mode: 0o700 })
  app.setPath('logs', logs)
  const visible = process.argv.includes('--tonnet-package-smoke-visible') && !process.env.CI
  return { profile, phase, report, url, visible }
}

async function until(check: () => Promise<boolean> | boolean, label: string): Promise<void> {
  const deadline = Date.now() + 30_000
  while (!(await check())) {
    assert(Date.now() < deadline, `Timed out: ${label}`)
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  }
}

/** Step 1: real connection from the landing screen, then a real TON site. */
export async function runPackageSmoke(
  config: PackageSmoke,
  window: BrowserWindow,
  services: ServiceRegistry
): Promise<void> {
  const checks: string[] = []
  const pass = (message: string): void => {
    checks.push(message)
    process.stdout.write(`PASS live: ${message}\n`)
  }
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
  await window.webContents.executeJavaScript(`(() => {
    const input = document.getElementById('address-bar-input');
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'manifesto.ton');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await new Promise((resolveWait) => setTimeout(resolveWait, config.visible ? 2000 : 100))
  await window.webContents.executeJavaScript(
    "document.getElementById('address-bar-input').closest('form').requestSubmit()"
  )
  pass('manifesto.ton submitted through the address bar')
  const siteDeadline = Date.now() + 120_000
  let document: { url: string; title: string; text: string } | null = null
  while (!document) {
    assert(Date.now() < siteDeadline, 'manifesto.ton did not load within 120 seconds')
    const view = services.tabManager.getActiveView()
    if (view && !view.webContents.isLoading()) {
      const url = view.webContents.getURL()
      if (url.startsWith('http://manifesto.ton')) {
        const content = await view.webContents
          .executeJavaScript("({url: location.href, title: document.title, text: document.body?.innerText ?? ''})")
          .catch(() => null)
        if (
          content &&
          new URL(content.url).hostname === 'manifesto.ton' &&
          content.text.length > 200 &&
          /manifesto/i.test(content.title + content.text)
        )
          document = content
      }
    }
    if (!document) await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  pass(`real manifesto.ton rendered: ${document.title} (${document.text.length} text characters)`)
  if (config.visible) await new Promise((resolvePause) => setTimeout(resolvePause, 2000))
  await window.webContents.executeJavaScript('window.electron.proxy.disconnect()')
  assert(!services.proxyManager.isRunning(), 'Proxy still running after disconnect')
  assert(!services.storageManager.getStatus().running, 'Storage still running after disconnect')
  pass('test proxy and Storage disconnected cleanly')
  await writeFile(
    config.report,
    JSON.stringify(
      {
        ok: true,
        packaged: app.isPackaged,
        version: app.getVersion(),
        phase: config.phase,
        checks,
        site: { url: document.url, title: document.title, textLength: document.text.length },
      },
      null,
      2
    )
  )
  app.quit()
}
