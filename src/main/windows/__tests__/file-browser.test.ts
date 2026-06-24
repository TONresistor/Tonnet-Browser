// @vitest-environment happy-dom
/**
 * Security regression tests for the TON Storage file browser page. Bag file
 * names are attacker-controlled, so the page must not let a hostile name break
 * out of the inline <script> (F-01) or out of an HTML attribute in the
 * client-side render (the sibling DOM-XSS via the navigation links).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { generateFileBrowserPage } from '../file-browser'

/** Run the page's inline client script against a real DOM and return it. */
function renderClient(html: string): Document {
  const body = html.split('<body>')[1].split('</body>')[0]
  const script = body.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? ''
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/, '')
  new Function(script)()
  return document
}

const bag = 'a'.repeat(64)

describe('generateFileBrowserPage security', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('carries a nonce CSP and tags its own script with the matching nonce', () => {
    const html = generateFileBrowserPage('example.ton', bag, [{ name: 'a.txt', size: 1 }])
    const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] ?? ''
    const cspNonce = csp.match(/script-src 'nonce-([^']+)'/)?.[1]
    const tagNonce = html.match(/<script nonce="([^"]+)"/)?.[1]
    expect(cspNonce).toBeTruthy()
    expect(tagNonce).toBe(cspNonce)
    expect(csp).toContain("default-src 'none'")
  })

  it('does not interpolate paths into inline event handlers', () => {
    const html = generateFileBrowserPage('example.ton', bag, [{ name: 'dir/f.txt', size: 1 }])
    expect(html).not.toContain('onclick=')
  })

  it('does not let a hostile file name break out of the inline script (F-01)', () => {
    const html = generateFileBrowserPage('example.ton', bag, [
      { name: '</script><script>window.PWNED=1</script>/x.txt', size: 1 },
    ])
    // The raw closing tag from data must be \uXXXX-escaped, never literal.
    expect(html).not.toContain('</script><script>window.PWNED')
  })

  it('does not inject a tag when a folder name contains an attribute breakout', () => {
    const html = generateFileBrowserPage('example.ton', bag, [
      { name: '"><img src=x onerror=alert(1)>/inner.txt', size: 10 },
    ])
    const doc = renderClient(html)
    // The payload must not have created a real <img> element in the page.
    expect(doc.querySelectorAll('img').length).toBe(0)
    // The folder link keeps the path safely in data-path, not as live markup.
    const link = doc.querySelector('a.folder-link') as HTMLAnchorElement | null
    expect(link).not.toBeNull()
    expect(link?.getAttribute('data-path')).toContain('"><img')
  })

  it('renders ordinary files and folders without injection', () => {
    const html = generateFileBrowserPage('example.ton', bag, [
      { name: 'photos/cat.png', size: 2048 },
      { name: 'readme.txt', size: 12 },
    ])
    const doc = renderClient(html)
    expect(doc.querySelector('a.folder-link')?.textContent).toBe('photos/')
    expect(doc.querySelectorAll('#file-list tr').length).toBe(2)
  })
})
