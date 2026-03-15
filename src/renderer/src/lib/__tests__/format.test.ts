// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { formatBytes, formatSpeed } from '../format'

describe('format', () => {
  describe('formatBytes', () => {
    it('returns "0 B" for zero bytes', () => {
      expect(formatBytes(0)).toBe('0 B')
    })

    it('formats bytes correctly', () => {
      expect(formatBytes(500)).toBe('500.0 B')
      expect(formatBytes(1)).toBe('1.0 B')
    })

    it('formats kilobytes correctly', () => {
      expect(formatBytes(1024)).toBe('1.0 KB')
      expect(formatBytes(1536)).toBe('1.5 KB')
      expect(formatBytes(10240)).toBe('10.0 KB')
    })

    it('formats megabytes correctly', () => {
      expect(formatBytes(1048576)).toBe('1.0 MB')
      expect(formatBytes(1572864)).toBe('1.5 MB')
    })

    it('formats gigabytes correctly', () => {
      expect(formatBytes(1073741824)).toBe('1.0 GB')
      expect(formatBytes(2147483648)).toBe('2.0 GB')
    })

    it('formats terabytes correctly', () => {
      expect(formatBytes(1099511627776)).toBe('1.0 TB')
    })
  })

  describe('formatSpeed', () => {
    it('appends /s suffix to formatted bytes', () => {
      expect(formatSpeed(0)).toBe('0 B/s')
      expect(formatSpeed(1024)).toBe('1.0 KB/s')
      expect(formatSpeed(1048576)).toBe('1.0 MB/s')
    })

    it('formats realistic download speeds', () => {
      // 5 MB/s
      expect(formatSpeed(5242880)).toBe('5.0 MB/s')
      // 100 KB/s
      expect(formatSpeed(102400)).toBe('100.0 KB/s')
    })
  })
})
