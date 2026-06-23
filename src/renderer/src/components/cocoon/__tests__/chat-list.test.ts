import { describe, it, expect } from 'vitest'
import { relativeTime, conversationPreview } from '../chat-list'

describe('relativeTime', () => {
  const now = 1_000_000_000_000

  it('formats sub-minute as "now"', () => {
    expect(relativeTime(now - 30_000, now)).toBe('now')
  })

  it('formats minutes and hours', () => {
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5m')
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h')
  })

  it('formats days under a week', () => {
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2d')
  })

  it('falls back to a locale date beyond a week', () => {
    const ts = now - 10 * 86_400_000
    expect(relativeTime(ts, now)).toBe(new Date(ts).toLocaleDateString())
  })
})

describe('conversationPreview', () => {
  it('returns a placeholder when there are no messages', () => {
    expect(conversationPreview({ messages: [] })).toBe('No messages yet')
  })

  it('prefixes user messages with "You:"', () => {
    expect(conversationPreview({ messages: [{ id: '1', role: 'user', content: 'hello there' }] })).toBe(
      'You: hello there'
    )
  })

  it('strips think blocks and collapses whitespace for assistant messages', () => {
    expect(
      conversationPreview({
        messages: [{ id: '1', role: 'assistant', content: '<think>reasoning</think>  Hi\n  again' }],
      })
    ).toBe('Hi again')
  })

  it('returns the placeholder when only a think block remains', () => {
    expect(
      conversationPreview({ messages: [{ id: '1', role: 'assistant', content: '<think>only thinking</think>' }] })
    ).toBe('No messages yet')
  })
})
