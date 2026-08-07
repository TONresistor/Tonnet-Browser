import { describe, expect, it } from 'vitest'
import { toIpcOverlayBounds } from '../overlay-position'

describe('overlay IPC bounds', () => {
  it('normalizes fractional DOM geometry to valid Electron integer bounds', () => {
    expect(
      toIpcOverlayBounds({
        x: 1280.625,
        y: 104.375,
        width: 219.75,
        height: 147.5,
      })
    ).toEqual({ x: 1281, y: 104, width: 220, height: 148 })
  })

  it('keeps rounded dimensions positive for the overlay contract', () => {
    expect(toIpcOverlayBounds({ x: 0, y: 0, width: 0.4, height: 0.4 })).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    })
  })
})
