import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserWindow, WebContents } from 'electron'
import type { BookmarksData } from '../shared/ipc-contract/bookmarks'
import type { ServiceRegistry } from './services'
import { BOOKMARKS_SAVE_DEBOUNCE_MS } from '../shared/constants'
import {
  assertLivePage,
  assertPackageOverlayClosed,
  packageTestStep,
  waitForPackageCheck,
} from './packaged-page-assertions'

interface SmokeContext {
  window: BrowserWindow
  services: ServiceRegistry
  profile: string
  phase: string
  pass: (message: string) => void
}

// All mutations go through rendered controls; IPC is used only to observe the
// persisted result. Never import the renderer store or call its actions here.
export async function runBookmarksScenario({ window, services, profile, phase, pass }: SmokeContext): Promise<void> {
  const chrome = window.webContents
  const until = (check: () => Promise<boolean> | boolean, label: string | (() => string), timeout = 30_000) =>
    waitForPackageCheck(check, () => `Bookmarks timed out: ${typeof label === 'function' ? label() : label}`, timeout)
  const evaluate = <T>(code: string, contents: WebContents = chrome): Promise<T> =>
    packageTestStep<T>(
      () => contents.executeJavaScript(code, true),
      `Bookmarks renderer did not respond: ${code.slice(0, 100)}`,
      120_000
    )
  const click = async (selector: string, contents: WebContents = chrome) => {
    await until(
      () =>
        evaluate<boolean>(
          `Boolean(document.querySelector(${JSON.stringify(selector)})?.getClientRects().length)`,
          contents
        ),
      `control ${selector}`
    )
    assert(
      await evaluate<boolean>(
        `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el.disabled) return false;
      el.click(); return true;
    })()`,
        contents
      ),
      `Disabled control ${selector}`
    )
  }
  const fill = async (selector: string, value: string, contents: WebContents = chrome) => {
    await until(
      () => evaluate<boolean>(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, contents),
      selector
    )
    await evaluate(
      `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      el.focus();
      const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', {bubbles:true}));
    })()`,
      contents
    )
    // React must commit controlled state before a separate click/submission.
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const data = (): Promise<BookmarksData> => evaluate('window.electron.bookmarks.load()')
  let lastDrag: unknown
  const waitData = async (predicate: (state: BookmarksData) => boolean, label: string) => {
    let saved: BookmarksData | undefined
    try {
      await until(async () => {
        saved = await data()
        return predicate(saved)
      }, label)
    } catch (error) {
      process.stdout.write(`FAIL favorites data: ${JSON.stringify({ label, saved, drag: lastDrag })}\n`)
      throw error
    }
    return data()
  }
  const normalized = (value: unknown) => JSON.parse(JSON.stringify(value))
  const diskData = async (): Promise<BookmarksData> => {
    const disk = JSON.parse(await readFile(join(profile, 'bookmarks.json'), 'utf8'))
    return { bookmarks: disk.bookmarks, folders: disk.folders }
  }
  const assertUnchanged = async (expected: BookmarksData, label: string, dismissedOverlay?: WebContents) => {
    if (dismissedOverlay) await assertPackageOverlayClosed(window, dismissedOverlay, label)
    await until(
      () =>
        evaluate<boolean>(
          `!document.querySelector('[data-testid="bookmarks-reset-cancel"], [data-testid="folder-cancel"], [data-testid="bookmark-cancel"]')`
        ),
      `${label}: dialog closed`
    )
    const deadline = Date.now() + BOOKMARKS_SAVE_DEBOUNCE_MS + 500
    do {
      assert.deepEqual(normalized(await data()), normalized(expected), `${label}: IPC state changed`)
      assert.deepEqual(await diskData(), normalized(expected), `${label}: disk state changed`)
      await new Promise((resolve) => setTimeout(resolve, 50))
    } while (Date.now() < deadline)
    if (await evaluate<boolean>("Boolean(document.querySelector('[data-testid=bookmarks-search]'))")) {
      await click('[data-folder-row=root]')
      await until(async () => {
        const shown = await evaluate(
          "Array.from(document.querySelectorAll('[data-bookmark-row]'),row=>({id:row.dataset.bookmarkRow,title:row.querySelector('[data-testid=bookmark-open]')?.textContent,url:row.querySelector('[data-testid=bookmark-open]')?.nextElementSibling?.textContent}))"
        )
        const wanted = [...expected.bookmarks]
          .sort((a, b) => a.order - b.order)
          .map(({ id, title, url }) => ({ id, title, url }))
        return JSON.stringify(shown) === JSON.stringify(wanted)
      }, `${label}: rendered titles, URLs and order unchanged`)
    }
  }
  const waitSite = async (url: string) => {
    let lastFailure = 'page not ready'
    await until(
      async () => {
        const view = services.tabManager.getActiveView()
        if (!view || view.webContents.isLoading() || !window.contentView.children.includes(view)) {
          lastFailure = 'active page missing, loading or detached'
          return false
        }
        const snapshot = await evaluate<import('./packaged-page-assertions').LivePageSnapshot>(
          `({url:location.href,title:document.title,text:document.body?.innerText ?? '',headings:Array.from(document.querySelectorAll('h1,h2'),h=>h.textContent.trim()), formCount:document.querySelectorAll('form').length, links:Array.from(document.querySelectorAll('a[href]'),a=>a.href)})`,
          view.webContents
        ).catch((error) => {
          lastFailure = String(error)
          return null
        })
        if (!snapshot) return false
        try {
          assertLivePage(snapshot, url)
          return true
        } catch (error) {
          lastFailure = error instanceof Error ? error.message : String(error)
          return false
        }
      },
      () => `real bookmarked page ${url}; last failure: ${lastFailure}`,
      120_000
    )
  }
  const navigate = async (url: string) => {
    await fill('#address-bar-input', url)
    await evaluate("document.getElementById('address-bar-input').closest('form').requestSubmit()")
    if (url === 'ton://bookmarks') {
      await until(
        () => evaluate<boolean>("Boolean(document.querySelector('[data-testid=bookmarks-search]'))"),
        'manager open'
      )
    } else {
      await waitSite(url)
    }
  }

  const manager = () => navigate('ton://bookmarks')
  const row = (id: string) => `[data-bookmark-row="${id}"]`
  const folderRow = (id: string | null) => `[data-folder-row="${id ?? 'root'}"]`
  const bar = (id: string) => `[data-bookmark-bar-id="${id}"]`
  const folderBar = (id: string) => `[data-folder-bar-id="${id}"]`
  const action = (name: string) => `[data-testid="${name}"]`
  const assertRows = async (ids: string[]) => {
    const shown = () =>
      evaluate<string[]>("Array.from(document.querySelectorAll('[data-bookmark-row]'), el => el.dataset.bookmarkRow)")
    try {
      await until(
        async () => JSON.stringify(await shown()) === JSON.stringify(ids),
        `displayed bookmark rows ${ids.join(',')}`
      )
    } catch (error) {
      process.stdout.write(
        `FAIL favorites rows: ${JSON.stringify({ expected: ids, actual: await shown(), saved: await data(), ui: await evaluate("({query:document.querySelector('[data-testid=bookmarks-search]')?.value, folders:Array.from(document.querySelectorAll('[data-folder-row]'), el => ({id:el.dataset.folderRow,className:el.className})), text:document.body.innerText.slice(-2500)})") })}\n`
      )
      throw error
    }
  }
  const selectFolder = (id: string | null) => click(folderRow(id))
  const createFolder = async (name: string, parent: string | null = null) => {
    await selectFolder(parent)
    await click(action('folder-new'))
    assert(
      await evaluate<boolean>("document.querySelector('[data-testid=folder-create]').disabled"),
      'Empty folder name accepted'
    )
    await fill(action('folder-name'), name)
    await click(action('folder-create'))
    const state = await waitData(
      (s) => s.folders.some((f) => f.name === name && f.parentId === parent),
      'folder persisted'
    )
    return state.folders.find((f) => f.name === name && f.parentId === parent)!.id
  }
  const edit = async (id: string, title: string, url: string, folder: string | null) => {
    await click(`${row(id)} ${action('bookmark-edit')}`)
    await fill(action('bookmark-title'), title)
    await fill(action('bookmark-url'), url)
    await fill(action('bookmark-folder'), folder ?? '')
    await click(action('bookmark-save'))
    await waitData(
      (s) => s.bookmarks.some((b) => b.id === id && b.title === title && b.url === url && b.folderId === folder),
      'edited bookmark persisted'
    )
  }
  const reset = async () => {
    await click(action('bookmarks-reset'))
    await click(action('bookmarks-reset-confirm'))
    await waitData((s) => s.bookmarks.length === 0 && s.folders.length === 0, 'reset persisted')
    await assertRows([])
  }
  const expectFile = join(profile, 'bookmarks-smoke-expected.json')
  const saveExpected = async () => {
    const state = await data()
    // Read the actual repository file, not just its in-memory cache.
    await until(async () => {
      const disk = JSON.parse(await readFile(join(profile, 'bookmarks.json'), 'utf8'))
      return JSON.stringify({ bookmarks: disk.bookmarks, folders: disk.folders }) === JSON.stringify(state)
    }, 'repository file flushed')
    await writeFile(expectFile, JSON.stringify(state))
  }
  const closeActive = async (returnId: string, expectReturn = true) => {
    const id = services.tabManager.getActiveTabId()
    assert(id && id !== returnId)
    await click(`[role=tab][data-tab-id="${id}"] ${action('browser-close-tab')}`)
    await until(
      () => !services.tabManager.hasTab(id) && (!expectReturn || services.tabManager.getActiveTabId() === returnId),
      'bookmark tab closed'
    )
  }
  const overlay = async (): Promise<WebContents> => {
    let result: WebContents | undefined
    await until(async () => {
      for (const child of window.contentView.children) {
        if (!('webContents' in child)) continue
        const contents = child.webContents as WebContents
        if (contents.getURL() !== 'app://overlay/overlay.html') continue
        if (await evaluate<boolean>("Boolean(document.querySelector('.menu-item,.form-container'))", contents)) {
          result = contents
          return true
        }
      }
      return false
    }, 'bookmark overlay attached')
    assert(result)
    return result
  }
  const contextMenu = async (selector: string) => {
    // Dismissal is asynchronous IPC from the overlay renderer. Wait until the
    // old view is detached before opening another menu, otherwise its late
    // Escape action can dismiss the next menu with the same overlay id.
    await until(
      () =>
        !window.contentView.children.some(
          (child) =>
            'webContents' in child && (child.webContents as WebContents).getURL() === 'app://overlay/overlay.html'
        ),
      'previous overlay dismissed'
    )
    await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Context target missing');
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:rect.x+10, clientY:rect.y+10, button:2}));
    })()`)
    return overlay()
  }
  const menuClick = async (id: string, contents: WebContents) => click(`[data-action="${id}"]:not(.disabled)`, contents)
  const drag = async (source: string, target: string, axis: 'x' | 'y' = 'y') => {
    const bounds = await evaluate<Array<{ x: number; y: number }>>(`(() => {
      const elements = [${JSON.stringify(source)}, ${JSON.stringify(target)}].map(selector => {
        const el = document.querySelector(selector);
        if (!el) throw new Error('Drag target missing: ' + selector);
        el.scrollIntoView({block:'nearest', inline:'nearest'});
        return el;
      });
      const bounds = elements.map(el => {
        const r=el.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
      });
      elements.forEach((el, i) => {
        if (!el.contains(document.elementFromPoint(bounds[i].x, bounds[i].y)))
          throw new Error('Drag point is obscured or outside the viewport: ' + [${JSON.stringify(source)}, ${JSON.stringify(target)}][i]);
      });
      const trace = {downOnSource:false, movesWithButton:0, movesWithoutButton:0};
      const down = event => { trace.downOnSource = elements[0].contains(event.target); };
      const move = event => { if(event.buttons & 1) trace.movesWithButton++; else trace.movesWithoutButton++; };
      document.addEventListener('pointerdown', down, true);
      document.addEventListener('pointermove', move, true);
      window.__packageDrag = {trace, cleanup:()=>{
        document.removeEventListener('pointerdown', down, true);
        document.removeEventListener('pointermove', move, true);
        delete window.__packageDrag;
      }};
      return bounds;
    })()`)
    const [from, to] = bounds
    try {
      chrome.sendInputEvent({ type: 'mouseMove', ...from })
      chrome.sendInputEvent({ type: 'mouseDown', ...from, button: 'left', clickCount: 1 })
      for (let i = 1; i <= 12; i++) {
        chrome.sendInputEvent({
          type: 'mouseMove',
          x: Math.round(from.x + ((to.x - from.x) * i) / 12),
          y: Math.round(from.y + ((to.y - from.y) * i) / 12),
          button: 'left',
          modifiers: ['leftbuttondown'],
        })
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    } finally {
      chrome.sendInputEvent({ type: 'mouseUp', ...to, button: 'left', clickCount: 1 })
      await new Promise((resolve) => setTimeout(resolve, axis === 'x' ? 400 : 200))
      const trace = await evaluate<{ downOnSource: boolean; movesWithButton: number; movesWithoutButton: number }>(
        '(() => { const {trace,cleanup}=window.__packageDrag; cleanup(); return trace; })()'
      )
      lastDrag = { source, target, from, to, ...trace }
      assert(trace.downOnSource && trace.movesWithButton > 0, `Drag input not received: ${JSON.stringify(lastDrag)}`)
    }
  }

  const expectSmokeFile = join(profile, 'smoke-bookmark-expected.json')
  if (phase === 'smoke') {
    const url = 'http://piracy.ton/add.html'
    await navigate(url)
    const before = await data()
    const existing = before.bookmarks.find((b) => b.url === url)
    if (existing) {
      await click(action('bookmark-toggle'))
      await waitData((s) => !s.bookmarks.some((b) => b.url === url), 'smoke target initially unbookmarked')
    }
    await click(action('bookmark-toggle'))
    const saved = await waitData((s) => s.bookmarks.some((b) => b.url === url), 'smoke star persisted')
    const bookmark = saved.bookmarks.find((b) => b.url === url)!
    await manager()
    await click(`${row(bookmark.id)} ${action('bookmark-open')}`)
    await waitSite(url)
    assert.deepEqual(await diskData(), normalized(saved))
    await writeFile(expectSmokeFile, JSON.stringify(saved))
    pass('SMK-06: star, manager and real bookmarked page verified; durable data prepared for restart')
    return
  }
  if (phase === 'smoke-resume') {
    const expected = JSON.parse(await readFile(expectSmokeFile, 'utf8')) as BookmarksData
    await manager()
    assert.deepEqual(
      normalized(await data()),
      expected,
      'Smoke favorites changed across real restart with clearOnExit=true'
    )
    assert.deepEqual(await diskData(), expected)
    const bookmark = expected.bookmarks.find((b) => b.url === 'http://piracy.ton/add.html')!
    assert(bookmark)
    await click(`${row(bookmark.id)} ${action('bookmark-open')}`)
    await waitSite(bookmark.url)
    pass('SMK-06: favorite survived clear-on-exit and reopened after a real process restart')
    return
  }
  assert(
    ['bookmarks', 'bookmarks-resume', 'bookmarks-folders-resume', 'bookmarks-empty-resume'].includes(phase),
    'Unknown bookmark E2E phase'
  )
  await manager()
  if (phase !== 'bookmarks') {
    const expected = JSON.parse(await readFile(expectFile, 'utf8')) as BookmarksData
    assert.deepEqual(await data(), expected, 'Bookmarks/folders changed after restarting the actual package')
    for (const folder of expected.folders.filter((f) => !f.parentId))
      assert(
        await evaluate<boolean>(`Boolean(document.querySelector(${JSON.stringify(folderRow(folder.id))}))`),
        'Persisted folder missing from UI'
      )
    await assertRows([...expected.bookmarks].sort((a, b) => a.order - b.order).map((b) => b.id))
    pass(
      `favorites: ${phase === 'bookmarks-resume' ? 'bookmarks and nested folders' : phase === 'bookmarks-folders-resume' ? 'folders without bookmarks' : 'empty favorites'} restored after a real package restart`
    )
    if (phase === 'bookmarks-resume') {
      const bookmark = expected.bookmarks[0]
      assert(bookmark)
      const managerTab = services.tabManager.getActiveTabId()!
      await click(`${row(bookmark.id)} ${action('bookmark-open-new')}`)
      await until(() => services.tabManager.getActiveTabId() !== managerTab, 'persisted bookmark opened')
      await waitSite(bookmark.url)
      await closeActive(managerTab)
      await reset()
      await createFolder('Smoke folders-only')
      await saveExpected()
      pass('favorites: persisted bookmark reopened; folders-only persistence prepared')
    } else if (phase === 'bookmarks-folders-resume') {
      await reset()
      await saveExpected()
      pass('favorites: reset removed all saved bookmarks and folders; empty restart prepared')
    } else {
      assert.deepEqual(expected, { bookmarks: [], folders: [] })
      await assertRows([])
      assert.deepEqual(await diskData(), expected)
      pass('favorites: fully empty reset state restored after a real process restart')
    }
    return
  }

  const initial = await data()
  await click(action('bookmarks-reset'))
  await click(action('bookmarks-reset-cancel'))
  await assertUnchanged(initial, 'Cancelled reset')
  await reset()
  pass('favorites: reset cancellation preserves data; confirmation clears it')
  const target = 'http://piracy.ton/add.html'
  await navigate(target)
  const toggle = action('bookmark-toggle')
  await click(toggle)
  const added = await waitData((s) => s.bookmarks.length === 1 && s.bookmarks[0].url === target, 'star added real page')
  assert(
    await evaluate<boolean>(`document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-pressed') === 'true'`)
  )
  await click(toggle)
  await waitData((s) => s.bookmarks.length === 0, 'star removed bookmark')
  await click(toggle)
  let state = await waitData((s) => s.bookmarks.length === 1, 'star re-added bookmark')
  const a = state.bookmarks[0].id
  assert.notEqual(a, added.bookmarks[0].id)
  await navigate('http://manifesto.ton/')
  await click(toggle)
  state = await waitData((s) => s.bookmarks.length === 2, 'second real page bookmarked')
  const b = state.bookmarks.find((item) => item.id !== a)!.id
  pass('favorites: star adds, removes and re-adds real TON pages with no duplicates')

  await manager()
  const beforeFolderCancel = await data()
  await click(action('folder-new'))
  await fill(action('folder-name'), 'Cancelled folder')
  await click(action('folder-cancel'))
  await assertUnchanged(beforeFolderCancel, 'Cancelled folder creation')
  const parent = await createFolder('Smoke parent')
  const child = await createFolder('Smoke child', parent)
  const leaf = await createFolder('Smoke leaf', child)
  await click(action('folder-new'))
  await until(
    () => evaluate<boolean>("Boolean(document.querySelector('[data-testid=folder-depth-warning]'))"),
    'maximum folder depth warning'
  )
  assert.equal((await data()).folders.length, 3)
  assert.equal(await evaluate("document.querySelector('[data-testid=folder-name]') === null"), true)
  const beforeFolderRenameCancel = await data()
  await click(`${folderRow(leaf)} ${action('folder-rename')}`)
  await fill(action('folder-name'), 'Cancelled rename')
  await click(action('folder-cancel'))
  await assertUnchanged(beforeFolderRenameCancel, 'Cancelled folder rename')
  await click(`${folderRow(leaf)} ${action('folder-rename')}`)
  await fill(action('folder-name'), 'Smoke renamed')
  await click(action('folder-save'))
  await waitData((s) => s.folders.some((f) => f.id === leaf && f.name === 'Smoke renamed'), 'folder renamed')
  pass('favorites: folder creation/cancel, three nested levels, depth limit and rename/cancel')

  await selectFolder(null)
  const beforeBookmarkCancel = await data()
  await click(`${row(a)} ${action('bookmark-edit')}`)
  await fill(action('bookmark-title'), 'Cancelled bookmark edit')
  await fill(action('bookmark-url'), 'http://manifesto.ton/')
  await click(action('bookmark-cancel'))
  await assertUnchanged(beforeBookmarkCancel, 'Cancelled bookmark edit')
  await edit(a, 'Smoke piracy edited', 'http://piracy.ton/', leaf)
  await selectFolder(leaf)
  await assertRows([a])
  await edit(a, 'Smoke piracy edited', target, parent)
  await selectFolder(parent)
  await assertRows([a])
  await edit(a, 'Smoke piracy edited', target, null)
  await selectFolder(null)
  await fill(action('bookmarks-search'), 'SMOKE PIRACY')
  await assertRows([a])
  await fill(action('bookmarks-search'), 'manifesto.ton')
  await assertRows([b])
  await fill(action('bookmarks-search'), 'no-such-favorite-817452')
  await assertRows([])
  await fill(action('bookmarks-search'), '')
  await assertRows([a, b])
  pass('favorites: edit/cancel title and URL; move between folders and root; search by title/URL and empty results')

  await drag(`${row(a)} ${action('bookmark-drag')}`, `${row(b)} ${action('bookmark-drag')}`)
  await waitData(
    (s) =>
      s.bookmarks.find((item) => item.id === b)!.order === 0 && s.bookmarks.find((item) => item.id === a)!.order === 1,
    'manager drag reorder'
  )
  await assertRows([b, a])
  await drag(`${row(a)} ${action('bookmark-drag')}`, folderRow(parent))
  await waitData((s) => s.bookmarks.find((item) => item.id === a)!.folderId === parent, 'manager drag into folder')
  await selectFolder(parent)
  await assertRows([a])
  await selectFolder(null)
  pass('favorites: real pointer drag reorders bookmarks and moves one into a folder')

  const managerTab = services.tabManager.getActiveTabId()!
  await click(`${row(a)} ${action('bookmark-open-new')}`)
  await until(() => services.tabManager.getActiveTabId() !== managerTab, 'bookmark new tab')
  await waitSite(target)
  await closeActive(managerTab)
  await click(`${row(a)} ${action('bookmark-open')}`)
  await waitSite(target)
  assert.equal(services.tabManager.getActiveTabId(), managerTab)
  await click(bar(b))
  await waitSite('http://manifesto.ton/')
  // Start elsewhere so a missing dropdown navigation cannot pass.
  await click(folderBar(parent))
  let menu = await overlay()
  await menuClick('navigate', menu)
  await waitSite(target)
  pass('favorites: manager opens current/new tab; toolbar bookmark and folder dropdown navigate')

  const beforeToolbarCancel = await data()
  menu = await contextMenu(bar(b))
  await menuClick('edit', menu)
  await fill('[data-field=name]', 'Cancelled toolbar edit', menu)
  await menuClick('dismiss', menu)
  await assertUnchanged(beforeToolbarCancel, 'Cancelled toolbar edit', menu)
  menu = await contextMenu(bar(b))
  await menuClick('edit', menu)
  await fill('[data-field=name]', 'Smoke manifesto toolbar', menu)
  await fill('[data-field=url]', 'http://manifesto.ton/', menu)
  await menuClick('save-edit', menu)
  await waitData(
    (s) => s.bookmarks.some((item) => item.id === b && item.title === 'Smoke manifesto toolbar'),
    'toolbar edit saved'
  )
  menu = await contextMenu(bar(b))
  await menuClick('open-new-tab', menu)
  await until(() => services.tabManager.getActiveTabId() !== managerTab, 'context opens new tab')
  await waitSite('http://manifesto.ton/')
  await closeActive(managerTab)
  menu = await contextMenu(folderBar(parent))
  await menuClick('rename-folder', menu)
  await fill('[data-field=name]', 'Smoke toolbar folder', menu)
  await menuClick('save-rename', menu)
  await waitData(
    (s) => s.folders.some((f) => f.id === parent && f.name === 'Smoke toolbar folder'),
    'toolbar rename saved'
  )
  await manager()
  await edit(b, 'Smoke manifesto toolbar', 'http://manifesto.ton/', parent)
  await navigate(target)
  const countBeforeOpenAll = await evaluate<number>("document.querySelectorAll('[role=tab]').length")
  menu = await contextMenu(folderBar(parent))
  await menuClick('open-all', menu)
  await until(
    async () => (await evaluate<number>("document.querySelectorAll('[role=tab]').length")) === countBeforeOpenAll + 2,
    'folder opens every bookmark in separate tabs'
  )
  await waitSite('http://manifesto.ton/')
  await closeActive(managerTab, false)
  await waitSite(target)
  await closeActive(managerTab)
  const beforeFolderDeleteCancel = await data()
  menu = await contextMenu(folderBar(parent))
  await menuClick('delete-folder', menu)
  await click(action('folder-delete-cancel'))
  await assertUnchanged(beforeFolderDeleteCancel, 'Cancelled toolbar folder deletion', menu)
  pass('favorites: toolbar context edit/cancel, new tab, folder rename/open-all and delete cancellation')

  await manager()
  const extraFolder = await createFolder('Smoke empty toolbar')
  await selectFolder(null)
  await edit(b, 'Smoke manifesto toolbar', 'http://manifesto.ton/', null)
  await edit(a, 'Smoke piracy edited', target, null)
  await navigate(target)
  await click(folderBar(extraFolder))
  menu = await overlay()
  assert(
    await evaluate<boolean>("Boolean(document.querySelector('[data-action=empty].disabled'))", menu),
    'Empty folder was not indicated'
  )
  // Dismiss via the overlay Escape handler, as with a physical keyboard.
  menu.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  menu.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await assertPackageOverlayClosed(window, menu, 'Empty folder Escape')
  const beforeToolbarRenameCancel = await data()
  menu = await contextMenu(folderBar(parent))
  await menuClick('rename-folder', menu)
  await fill('[data-field=name]', 'Cancelled toolbar folder', menu)
  await menuClick('dismiss', menu)
  await assertUnchanged(beforeToolbarRenameCancel, 'Cancelled toolbar folder rename', menu)
  await drag(bar(b), bar(a), 'x')
  await waitData(
    (s) =>
      s.bookmarks.find((item) => item.id === b)!.order === 0 && s.bookmarks.find((item) => item.id === a)!.order === 1,
    'toolbar bookmark reorder'
  )
  await drag(bar(a), folderBar(parent), 'x')
  await waitData((s) => s.bookmarks.find((item) => item.id === a)!.folderId === parent, 'toolbar drag into folder')
  await drag(folderBar(extraFolder), folderBar(parent), 'x')
  await waitData(
    (s) =>
      s.folders.find((f) => f.id === extraFolder)!.order === 0 && s.folders.find((f) => f.id === parent)!.order === 1,
    'toolbar folder reorder'
  )
  menu = await contextMenu(folderBar(extraFolder))
  await menuClick('delete-folder', menu)
  await click(action('folder-delete-confirm'))
  await waitData((s) => !s.folders.some((f) => f.id === extraFolder), 'toolbar confirmed folder deletion')
  pass('favorites: empty folder menu, rename cancellation, toolbar bookmark/folder drag and confirmed folder deletion')

  await manager()
  // Put a bookmark in a descendant before deleting its ancestor: it must survive
  // at root, with no dangling folder reference.
  await selectFolder(null)
  await edit(a, 'Smoke piracy edited', target, leaf)
  await click(`${folderRow(parent)} ${action('folder-delete')}`)
  assert(
    (await data()).folders.some((f) => f.id === parent),
    'Folder deleted without confirmation'
  )
  await click(`${folderRow(parent)} ${action('folder-delete')}`)
  await waitData((s) => s.folders.length === 0, 'folder subtree deleted')
  state = await data()
  assert.equal(
    state.bookmarks.find((item) => item.id === a)!.folderId,
    null,
    'Deleting ancestor stranded a descendant bookmark'
  )
  assert.equal(state.bookmarks.length, 2, 'Folder deletion lost bookmarks')
  await selectFolder(null)
  await click(`${row(a)} ${action('bookmark-delete')}`)
  assert.equal((await data()).bookmarks.length, 2, 'Bookmark deleted without confirmation')
  await click(`${row(a)} ${action('bookmark-delete')}`)
  await waitData((s) => s.bookmarks.length === 1, 'manager bookmark deleted')
  menu = await contextMenu(bar(b))
  await menuClick('delete-bookmark', menu)
  await waitData((s) => s.bookmarks.length === 0, 'toolbar bookmark deleted')
  await assertRows([])
  pass('favorites: deleting folder subtree preserves descendant bookmarks; manager/context deletions work')

  // Recreate a small meaningful dataset for export and an actual process restart.
  await navigate(target)
  await click(toggle)
  state = await waitData((s) => s.bookmarks.length === 1, 'persistence bookmark created')
  const saved = state.bookmarks[0].id
  await manager()
  const persistParent = await createFolder('Smoke persistent parent')
  await createFolder('Smoke persistent child', persistParent)
  await selectFolder(null)
  await edit(saved, 'Smoke persisted piracy', target, persistParent)
  const exportPath = join(profile, 'bookmarks-export.json')
  let exported = false
  const onDownload: (_event: Electron.Event, item: Electron.DownloadItem) => void = (_event, item) => {
    item.setSavePath(exportPath)
    item.once('done', (_event, status) => {
      exported = status === 'completed'
    })
  }
  chrome.session.once('will-download', onDownload)
  try {
    await click(action('bookmarks-export'))
    await until(() => exported, 'JSON export downloaded without a dialog')
  } finally {
    chrome.session.removeListener('will-download', onDownload)
  }
  assert.deepEqual(
    JSON.parse(await readFile(exportPath, 'utf8')),
    JSON.parse(JSON.stringify(await data())),
    'Export differs from saved favorites'
  )
  await saveExpected()
  pass('favorites: JSON export matches saved data; bookmark and nested folders flushed for restart')
}
