import { describe, expect, it } from 'vitest'
import { appendUniqueBounded, type ChatMsg } from '../util'

function message(index: number): ChatMsg {
  return {
    id: index.toString(16).padStart(64, '0'),
    nick: `user-${index}`,
    text: `message-${index}`,
    ts: index,
  }
}

describe('appendUniqueBounded', () => {
  it('keeps one message regardless of whether the network event or send response wins the race', () => {
    const sent = { ...message(1), self: true }
    const replayed = { ...message(1), self: true }

    expect(appendUniqueBounded(appendUniqueBounded([], sent), replayed)).toEqual([sent])
    expect(appendUniqueBounded(appendUniqueBounded([], replayed), sent)).toEqual([replayed])
  })

  it('keeps only the newest 500 unique messages', () => {
    const messages = Array.from({ length: 500 }, (_, index) => message(index))
    const bounded = appendUniqueBounded(messages, message(500))

    expect(bounded).toHaveLength(500)
    expect(bounded[0].id).toBe(message(1).id)
    expect(bounded[499].id).toBe(message(500).id)
    expect(appendUniqueBounded(bounded, message(500))).toBe(bounded)
  })
})
