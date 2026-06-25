import { describe, it, expect } from 'vitest'
import { escapeHtml, jsonForScript } from '../page-templates'

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;'
    )
  })
})

describe('jsonForScript', () => {
  it('escapes characters that could break out of a <script> element', () => {
    const out = jsonForScript('</script><img src=x onerror=alert(1)>')
    expect(out).not.toMatch(/<\/script/i)
    expect(out).not.toContain('<')
    expect(out).not.toContain('>')
    expect(out).toContain('\\u003c')
    expect(out).toContain('\\u003e')
  })

  it('escapes the U+2028 / U+2029 line separators invalid in JS strings', () => {
    const out = jsonForScript('a\u2028b\u2029c')
    expect(out).toContain('\\u2028')
    expect(out).toContain('\\u2029')
    expect(out).not.toContain('\u2028')
    expect(out).not.toContain('\u2029')
  })

  it('produces output that parses back to the original value (escapes are valid)', () => {
    const value = {
      name: '</script>"weird"<b>&amp;</b>\u2028end',
      size: 42,
      nested: ['a<b>c', { d: '>&<' }],
    }
    expect(JSON.parse(jsonForScript(value))).toEqual(value)
  })

  it('matches JSON.stringify for payloads with no dangerous characters', () => {
    const value = { name: 'photo.jpg', size: 1024 }
    expect(jsonForScript(value)).toBe(JSON.stringify(value))
  })
})
