// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { decodePunycodeUrl, processNavigationInput, stripHttpPrefix, getHostname } from '../url-utils'

describe('url-utils', () => {
  describe('processNavigationInput', () => {
    it('returns empty string for empty input', () => {
      expect(processNavigationInput('')).toBe('')
      expect(processNavigationInput('   ')).toBe('')
    })

    it('passes through ton:// internal pages unchanged', () => {
      expect(processNavigationInput('ton://start')).toBe('ton://start')
      expect(processNavigationInput('ton://settings')).toBe('ton://settings')
      expect(processNavigationInput('ton://storage')).toBe('ton://storage')
    })

    it('appends .ton to bare hostnames without a dot', () => {
      expect(processNavigationInput('example')).toBe('http://example.ton')
      expect(processNavigationInput('boards')).toBe('http://boards.ton')
    })

    it('preserves hostnames that already have a dot', () => {
      expect(processNavigationInput('example.ton')).toBe('http://example.ton')
      expect(processNavigationInput('sub.example.ton')).toBe('http://sub.example.ton')
    })

    it('strips http:// and re-adds it', () => {
      expect(processNavigationInput('http://example.ton')).toBe('http://example.ton')
      expect(processNavigationInput('http://boards.ton/page')).toBe('http://boards.ton/page')
    })

    it('strips https:// and uses http://', () => {
      expect(processNavigationInput('https://example.ton')).toBe('http://example.ton')
      expect(processNavigationInput('https://boards.ton/path')).toBe('http://boards.ton/path')
    })

    it('preserves path after hostname', () => {
      expect(processNavigationInput('example.ton/page/sub')).toBe('http://example.ton/page/sub')
      expect(processNavigationInput('example/page')).toBe('http://example.ton/page')
    })

    it('trims whitespace from input', () => {
      expect(processNavigationInput('  example  ')).toBe('http://example.ton')
      expect(processNavigationInput('  ton://start  ')).toBe('ton://start')
    })

    it('handles hostnames with port-like segments containing dots', () => {
      expect(processNavigationInput('example.ton:8080')).toBe('http://example.ton:8080')
    })

    it('canonicalizes Russian and emoji domains to Punycode', () => {
      expect(processNavigationInput('пример.ton')).toBe('http://xn--e1afmkfd.ton')
      expect(processNavigationInput('💩.ton')).toBe('http://xn--ls8h.ton')
      expect(processNavigationInput('xn--e1afmkfd.ton')).toBe('http://xn--e1afmkfd.ton')
    })

    it('preserves paths, queries, and fragments while canonicalizing the hostname', () => {
      expect(processNavigationInput('пример.ton/путь?q=1#top')).toBe('http://xn--e1afmkfd.ton/путь?q=1#top')
      expect(processNavigationInput('💩.ton?q=1')).toBe('http://xn--ls8h.ton?q=1')
    })
  })

  describe('decodePunycodeUrl', () => {
    it('decodes Russian and emoji hostnames without changing the navigation URL parts', () => {
      expect(decodePunycodeUrl('http://xn--e1afmkfd.ton/путь')).toBe('http://пример.ton/путь')
      expect(decodePunycodeUrl('http://xn--ls8h.ton:8080/chat')).toBe('http://💩.ton:8080/chat')
    })

    it('decodes only the hostname when credentials or matching path text are present', () => {
      expect(decodePunycodeUrl('http://xn--ls8h.ton@xn--ls8h.ton/')).toBe('http://xn--ls8h.ton@💩.ton/')
      expect(decodePunycodeUrl('http://user@xn--ls8h.ton:8080/chat')).toBe('http://user@💩.ton:8080/chat')
      expect(decodePunycodeUrl('http://xn--ls8h.ton/xn--ls8h.ton')).toBe('http://💩.ton/xn--ls8h.ton')
    })

    it('leaves ordinary and invalid URLs unchanged', () => {
      expect(decodePunycodeUrl('http://example.ton/path')).toBe('http://example.ton/path')
      expect(decodePunycodeUrl('not a url')).toBe('not a url')
    })
  })

  describe('stripHttpPrefix', () => {
    it('strips http:// prefix', () => {
      expect(stripHttpPrefix('http://example.ton')).toBe('example.ton')
    })

    it('strips https:// prefix', () => {
      expect(stripHttpPrefix('https://example.ton')).toBe('example.ton')
    })

    it('returns non-http URLs unchanged', () => {
      expect(stripHttpPrefix('ton://start')).toBe('ton://start')
      expect(stripHttpPrefix('ftp://example.ton')).toBe('ftp://example.ton')
    })

    it('returns plain strings unchanged', () => {
      expect(stripHttpPrefix('example.ton')).toBe('example.ton')
    })
  })

  describe('getHostname', () => {
    it('extracts hostname from valid URLs', () => {
      expect(getHostname('http://example.ton')).toBe('example.ton')
      expect(getHostname('http://example.ton/path/page')).toBe('example.ton')
      expect(getHostname('https://boards.ton:8080/test')).toBe('boards.ton')
    })

    it('falls back to first segment for invalid URLs', () => {
      expect(getHostname('example.ton/path')).toBe('example.ton')
      expect(getHostname('just-a-string')).toBe('just-a-string')
    })

    it('handles URLs with subdomains', () => {
      expect(getHostname('http://sub.example.ton')).toBe('sub.example.ton')
    })
  })
})
