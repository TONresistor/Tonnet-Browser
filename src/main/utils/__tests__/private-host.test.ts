import { describe, it, expect } from 'vitest'
import { isPrivateHost } from '../private-host'

describe('isPrivateHost', () => {
  it('blocks loopback and localhost', () => {
    for (const h of ['localhost', 'app.localhost', '127.0.0.1', '127.9.9.9', '0.0.0.0', '::1', '::']) {
      expect(isPrivateHost(h)).toBe(true)
    }
  })

  it('blocks RFC1918, link-local and CGNAT ranges', () => {
    for (const h of [
      '10.0.0.1',
      '10.255.255.255',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254', // cloud metadata
      '100.64.0.1',
    ]) {
      expect(isPrivateHost(h)).toBe(true)
    }
  })

  it('blocks IPv6 link-local and unique-local', () => {
    for (const h of ['fe80::1', 'fd00::1', 'fc00::1', '[fe80::1]']) {
      expect(isPrivateHost(h)).toBe(true)
    }
  })

  it('blocks IPv6-mapped IPv4 private addresses (hex and dotted)', () => {
    expect(isPrivateHost('::ffff:7f00:1')).toBe(true) // 127.0.0.1
    expect(isPrivateHost('::ffff:192.168.0.1')).toBe(true)
    expect(isPrivateHost('::ffff:a9fe:a9fe')).toBe(true) // 169.254.169.254
  })

  it('allows public hosts and non-private IPv4 that is out of range', () => {
    for (const h of [
      'example.ton',
      'boards.ton',
      'fc-barcelona.ton',
      '8.8.8.8',
      '172.15.0.1',
      '172.32.0.1',
      '192.167.0.1',
    ]) {
      expect(isPrivateHost(h)).toBe(false)
    }
  })
})
