import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import type { BrowserWindow } from 'electron'
import { STATIC_INTERNAL_ROUTE_PATHS, type StaticInternalRoutePath } from '../shared/internal-route-paths'
import type { ServiceRegistry } from './services'
import { assertStorageTable } from './packaged-page-assertions'
import { resolveBagFilePath } from './windows/tabs-storage'

interface Context {
  window: BrowserWindow
  services: ServiceRegistry
  profile: string
  submit: (url: string) => Promise<void>
  pass: (message: string) => void
  onlyStorageRemoval?: boolean
}

/** Page-level navigation only; no wallet creation, Messenger join or Cocoon activation. */
export async function runInternalRoutesSmoke({
  window,
  services,
  profile,
  submit,
  pass,
  onlyStorageRemoval = false,
}: Context): Promise<string[]> {
  const routes: string[] = []
  const until = async (check: () => Promise<boolean>, label: string | (() => string)) => {
    const deadline = Date.now() + 30_000
    while (!(await check())) {
      assert(Date.now() < deadline, `Internal route timed out: ${typeof label === 'function' ? label() : label}`)
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  const expected: Record<StaticInternalRoutePath, { page: string; selector: string }> = {
    start: { page: 'start', selector: 'form input' },
    settings: { page: 'settings', selector: 'h2' },
    theme: { page: 'theme', selector: 'button' },
    history: { page: 'history', selector: 'input' },
    bookmarks: { page: 'bookmarks', selector: 'input' },
    wallet: { page: 'wallet', selector: 'h1' },
    dns: { page: 'dns', selector: 'input' },
    storage: { page: 'storage', selector: 'input' },
    chat: { page: 'chat', selector: 'button' },
    // The shipped default disables Cocoon. Its route intentionally falls back
    // to StartPage. This does not count as testing Cocoon setup or chat.
    cocoon: { page: 'start', selector: 'form input' },
    loading: { page: 'loading', selector: '.animate-spin' },
  }
  const visit = async (url: string, kind: string, page: string, selector: string, text?: string) => {
    await submit(url)
    await until(async () => {
      const snapshot = await window.webContents.executeJavaScript(`(() => {
        const content = document.querySelector('[data-testid=internal-content]');
        const page = content?.querySelector(${JSON.stringify(`[data-testid="internal-page-${page}"]`)});
        const selected = document.querySelector('[role=tab][aria-selected=true]');
        return {kind:content?.dataset.internalRoute, ready:Boolean(page?.querySelector(${JSON.stringify(selector)})?.getClientRects().length), text:page?.innerText ?? '',
          selected: selected?.dataset.tabId, address:document.getElementById('address-bar-input')?.value,
          error:Boolean(document.querySelector('[data-testid=application-error]'))};
      })()`)
      assert(!snapshot.error, `Application error boundary at ${url}`)
      const active = services.tabManager.getActiveView()
      return (
        snapshot.kind === kind &&
        snapshot.ready &&
        snapshot.address === url &&
        snapshot.selected === services.tabManager.getActiveTabId() &&
        (!active || !window.contentView.children.includes(active)) &&
        (!text || snapshot.text.includes(text))
      )
    }, url)
    routes.push(url)
    pass(`internal route: ${url} rendered ${page}${kind === 'cocoon' ? ' (Cocoon disabled)' : ''}`)
  }
  // Create a tiny real bag on the disposable Storage daemon so parameterized
  // pages read real metadata/files instead of mocks or an endless placeholder.
  const fixture = join(profile, 'storage', 'smoke-route-bag')
  await mkdir(fixture, { recursive: true })
  await writeFile(join(fixture, 'smoke.csv'), 'name,value\nsmoke-route,42\n')
  const rawText = 'TONNET_ROUTE_SMOKE_RAW_FILE\n'
  await writeFile(join(fixture, 'hello.txt'), rawText)
  const client = services.storageManager.getClient()
  assert(client, 'Disposable Storage client is not ready')
  const created = await client.createBag(fixture, 'Disposable internal-route smoke fixture')
  assert(created.bag_id && /^[a-f0-9]{64}$/i.test(created.bag_id), 'Storage did not create a real fixture bag')
  const bagId = created.bag_id
  let removed = false
  const removeThroughUi = async () => {
    await visit('ton://storage', 'storage', 'storage', 'input')
    const [csvFile, textFile] = await Promise.all([
      resolveBagFilePath(services.tabManager.storage, bagId, 'smoke.csv'),
      resolveBagFilePath(services.tabManager.storage, bagId, 'hello.txt'),
    ])
    assert(
      [csvFile, textFile].every((path) => path.startsWith(profile + sep)),
      'Fixture files escaped the test profile'
    )
    const row = `[data-bag-row="${bagId}"]`
    await until(
      () => window.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(row)}))`),
      'fixture bag listed in Storage'
    )
    assert(
      await window.webContents.executeJavaScript(
        `(() => { const row = document.querySelector(${JSON.stringify(row)}); if (!row) return false; row.click(); return true })()`
      ),
      'Fixture bag row unavailable'
    )
    const removeButton = `${row} button[aria-label="Remove"]`
    await until(
      () =>
        window.webContents.executeJavaScript(
          `(() => { const button = document.querySelector(${JSON.stringify(removeButton)}); return Boolean(button && getComputedStyle(button.parentElement).pointerEvents !== 'none') })()`
        ),
      'Storage remove action available'
    )
    assert(
      await window.webContents.executeJavaScript(
        `(() => { const button = document.querySelector(${JSON.stringify(removeButton)}); if (!button) return false; button.click(); return true })()`
      ),
      'Storage remove action unavailable'
    )
    await until(async () => {
      const visible = await window.webContents.executeJavaScript(
        `Boolean(document.querySelector(${JSON.stringify(row)}))`
      )
      const bags = await client.listBags()
      return !visible && !bags.some((bag) => bag.bag_id === bagId)
    }, 'fixture bag removed from UI and Storage')
    removed = true
    assert.equal(await readFile(csvFile, 'utf8'), 'name,value\nsmoke-route,42\n')
    assert.equal(await readFile(textFile, 'utf8'), rawText)
    pass('storage: removed the fixture bag through the UI and preserved its files')
  }
  try {
    if (onlyStorageRemoval) {
      await removeThroughUi()
      return routes
    }
    for (const path of STATIC_INTERNAL_ROUTE_PATHS) {
      const { page, selector } = expected[path]
      await visit(`ton://${path}`, path, page, selector)
    }
    await visit(`ton://storage/browse/${bagId}`, 'storage-browse', 'storage-browse', 'button', 'smoke.csv')
    await visit(`ton://storage/view/${bagId}/smoke.csv`, 'storage-view', 'storage-view', '[role=button],header button')
    let lastTableFailure = 'table not ready'
    await until(
      async () => {
        const table = await window.webContents.executeJavaScript(`(() => {
        const table = document.querySelector('[data-testid=internal-page-storage-view] [role=table]');
        return {columns:Array.from(table?.querySelectorAll('[role=columnheader]:not([aria-label=Row])') ?? [], c=>c.textContent.trim()),
          rows:Array.from(table?.querySelectorAll('[role=row][data-row-index]') ?? [], r=>Array.from(r.querySelectorAll('[role=cell]'),c=>c.textContent.trim()))};
      })()`)
        try {
          assertStorageTable(table)
          return true
        } catch (error) {
          lastTableFailure = `${error instanceof Error ? error.message : String(error)}; actual: ${JSON.stringify(table)}`
          return false
        }
      },
      () => `CSV columns and every fixture cell exactly match; last failure: ${lastTableFailure}`
    )
    pass('SMK-03: CSV columns and cells match exactly, including value 42')
    const fileUrl = `ton://storage/file/${bagId}/hello.txt`
    await submit(fileUrl)
    await until(async () => {
      const view = services.tabManager.getActiveView()
      if (!view || view.webContents.isLoading() || !window.contentView.children.includes(view)) return false
      return view.webContents
        .executeJavaScript(
          `location.protocol === 'file:' && document.body.innerText.trim() === ${JSON.stringify(rawText.trim())}`
        )
        .catch(() => false)
    }, 'raw Storage file rendered in native view')
    routes.push(fileUrl)
    pass('internal route: ton://storage/file/<bag>/hello.txt rendered the real fixture file')
    await removeThroughUi()
    await visit('ton://smoke-unknown', 'fallback', 'start', 'form input')
    await visit('ton://start', 'start', 'start', 'form input')
    // The final StartPage navigation is cleanup, not another distinct route.
    routes.pop()
  } finally {
    if (!removed) await client.removeBag({ bag_id: bagId, with_files: false })
  }
  return routes
}
