import { describe, it, expect } from 'vitest'
import { signEnvelope } from './envelope'
import { classify } from './verify'

const seed = Buffer.alloc(32, 5)
const now = 1_000_000

describe('chat classify', () => {
  it('accepts a valid device-signed message for the room', () => {
    const e = signEnvelope({ type: 'msg', nick: 'a', text: 'hi', ts: 1, room: 'r1' }, seed)
    const v = classify(e, 'r1', now)
    expect(v.drop).toBe(false)
    if (!v.drop) expect(v.identity.tier).toBe('device')
  })

  it('drops an unsigned message', () => {
    expect(classify({ type: 'msg', nick: 'a', text: 'hi', ts: 1, room: 'r1' }, 'r1', now).drop).toBe(true)
  })

  it('drops a message signed for a different room', () => {
    const e = signEnvelope({ type: 'msg', nick: 'a', text: 'hi', ts: 1, room: 'other' }, seed)
    expect(classify(e, 'r1', now).drop).toBe(true)
  })

  it('accepts a message with no room binding (overlay-scoped)', () => {
    const e = signEnvelope({ type: 'msg', nick: 'a', text: 'hi', ts: 1 }, seed)
    expect(classify(e, 'r1', now).drop).toBe(false)
  })
})
