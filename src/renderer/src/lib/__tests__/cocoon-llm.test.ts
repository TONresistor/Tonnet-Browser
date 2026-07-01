/**
 * Unit tests for renderer lib/cocoon-llm.ts — the local cocoon-runner LLM transport.
 *
 * Mocks:
 *  - global fetch — controls the runner HTTP responses without binding a port.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseThinking, buildHistory, sendChat, DEFAULT_MODEL, type ChatMessage } from '../cocoon-llm'

describe('parseThinking', () => {
  it('returns the whole content as reply when there is no <think> block', () => {
    expect(parseThinking('hello world')).toEqual({ thinking: '', reply: 'hello world' })
  })

  it('splits a leading <think> block into trimmed thinking and the reply', () => {
    expect(parseThinking('<think>  reasoning here  </think>final answer')).toEqual({
      thinking: 'reasoning here',
      reply: 'final answer',
    })
  })

  it('handles a multi-line reasoning block', () => {
    const out = parseThinking('<think>line1\nline2</think>\n\nthe reply')
    expect(out.thinking).toBe('line1\nline2')
    expect(out.reply).toBe('the reply')
  })

  it('returns an empty reply when only a think block is present', () => {
    expect(parseThinking('<think>only thinking</think>')).toEqual({
      thinking: 'only thinking',
      reply: '',
    })
  })

  it('treats a <think> block that is not at the start as plain content', () => {
    const content = 'prefix <think>x</think> suffix'
    expect(parseThinking(content)).toEqual({ thinking: '', reply: content })
  })

  it('keeps an unterminated (truncated) <think> block out of the reply', () => {
    expect(parseThinking('<think>partial reasoning that was cut off')).toEqual({
      thinking: 'partial reasoning that was cut off',
      reply: '',
    })
  })
})

describe('buildHistory', () => {
  it('strips assistant reasoning but keeps user content verbatim', () => {
    const history = buildHistory([
      { role: 'user', content: 'question <think>keep</think>' },
      { role: 'assistant', content: '<think>secret reasoning</think>the answer' },
    ])
    expect(history).toEqual([
      { role: 'user', content: 'question <think>keep</think>' },
      { role: 'assistant', content: 'the answer' },
    ])
  })
})

describe('sendChat', () => {
  let originalFetch: typeof globalThis.fetch
  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }]
  const okBody = { choices: [{ message: { content: 'pong' } }] }

  function mockFetch(body: unknown, init?: { ok?: boolean; status?: number }) {
    const fn = vi.fn().mockResolvedValue({
      ok: init?.ok ?? true,
      status: init?.status ?? 200,
      json: async () => body,
    } as Response)
    globalThis.fetch = fn
    return fn
  }

  function sentBody(fn: ReturnType<typeof mockFetch>) {
    return JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string)
  }

  it('POSTs to the loopback runner on the given port with the default model', async () => {
    const fn = mockFetch(okBody)
    await sendChat({ port: 12345, messages, thinkingEnabled: true })

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn.mock.calls[0][0]).toBe('http://127.0.0.1:12345/v1/chat/completions')
    const sent = sentBody(fn)
    expect(sent.model).toBe(DEFAULT_MODEL)
    expect(sent.stream).toBe(false)
    expect(sent.messages).toEqual(messages)
  })

  it('prepends a /no_think system message when thinking is disabled', async () => {
    const fn = mockFetch(okBody)
    await sendChat({ port: 1, messages, thinkingEnabled: false })

    const sent = sentBody(fn)
    expect(sent.messages[0]).toEqual({ role: 'system', content: '/no_think' })
    expect(sent.messages.slice(1)).toEqual(messages)
  })

  it('returns the assistant content on success', async () => {
    mockFetch(okBody)
    await expect(sendChat({ port: 1, messages, thinkingEnabled: true })).resolves.toBe('pong')
  })

  it('throws with the status code on a non-ok response', async () => {
    mockFetch(null, { ok: false, status: 503 })
    await expect(sendChat({ port: 1, messages, thinkingEnabled: true })).rejects.toThrow('HTTP 503')
  })

  it('throws when the response carries no string content', async () => {
    mockFetch({ choices: [{ message: {} }] })
    await expect(sendChat({ port: 1, messages, thinkingEnabled: true })).rejects.toThrow('No content in response')
  })

  it('forwards the abort signal to fetch', async () => {
    const fn = mockFetch(okBody)
    const controller = new AbortController()
    await sendChat({ port: 1, messages, thinkingEnabled: true, signal: controller.signal })
    expect((fn.mock.calls[0][1] as RequestInit).signal).toBe(controller.signal)
  })
})
