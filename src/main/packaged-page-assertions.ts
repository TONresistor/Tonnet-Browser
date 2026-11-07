import assert from 'node:assert/strict'
import type { BrowserWindow, WebContents } from 'electron'

type FailureMessage = string | (() => string)

export async function packageTestStep<T>(
  operation: () => Promise<T> | T,
  failure: FailureMessage,
  timeoutMs = 30_000
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(typeof failure === 'function' ? failure() : failure)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function waitForPackageCheck(
  check: () => Promise<boolean> | boolean,
  failure: FailureMessage,
  timeoutMs = 30_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (true) {
    const remaining = deadline - Date.now()
    assert(remaining > 0, typeof failure === 'function' ? failure() : failure)
    if (await packageTestStep(check, failure, remaining)) return
    await new Promise((resolve) => setTimeout(resolve, Math.min(50, remaining)))
  }
}

export async function assertPackageOverlayClosed(
  window: BrowserWindow,
  contents: WebContents,
  label: string
): Promise<void> {
  await waitForPackageCheck(
    () => !window.contentView.children.some((child) => 'webContents' in child && child.webContents === contents),
    `${label}: overlay did not close`
  )
}

export async function focusPackageInput(window: BrowserWindow, contents: WebContents): Promise<void> {
  assert(window.isVisible(), 'Native package input requires a visible window')
  window.focus()
  contents.focus()
  await waitForPackageCheck(
    () => window.isFocused() && contents.isFocused(),
    'Native package input did not receive focus'
  )
}

export interface LivePageSnapshot {
  url: string
  title: string
  text: string
  headings: string[]
  formCount: number
  links: string[]
}

/** Oracles for the real sites used by the packaged test, never an arbitrary nonempty page. */
export function assertLivePage(page: LivePageSnapshot, expectedUrl: string): void {
  assert.equal(page.url, expectedUrl, 'Unexpected page URL')
  const url = new URL(expectedUrl)
  if (url.origin === 'http://manifesto.ton' && url.pathname === '/') {
    assert(page.text.length > 200, 'Manifesto body is incomplete')
    assert(/manifesto/i.test(page.title + page.text), 'Manifesto content missing')
    assert(
      /digital resistance manifesto/i.test(page.title + '\n' + page.headings.join('\n')),
      'Manifesto identity missing'
    )
  } else if (url.origin === 'http://piracy.ton' && url.pathname === '/') {
    assert(page.text.length > 200 && /piracy/i.test(page.title + page.text), 'Piracy homepage content missing')
    assert(page.links.includes('http://piracy.ton/add.html'), 'Piracy navigation link missing')
  } else if (url.origin === 'http://piracy.ton' && url.pathname === '/add.html') {
    assert(page.headings.includes('Add a Bag'), 'Add a Bag heading missing')
    assert(page.formCount > 0, 'Add a Bag form missing')
  } else {
    throw new Error(`No content contract for ${expectedUrl}`)
  }
}

export function assertStorageTable(actual: { columns: string[]; rows: string[][] }): void {
  assert.deepEqual(actual, { columns: ['name', 'value'], rows: [['smoke-route', '42']] }, 'Storage table cells differ')
}
