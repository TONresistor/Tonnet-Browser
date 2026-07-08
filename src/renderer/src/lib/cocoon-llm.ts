/**
 * Transport for the local cocoon-runner LLM endpoint. Kept out of the chat
 * component so the fetch shape and response parsing are testable in isolation.
 */

export const DEFAULT_MODEL = 'Qwen/Qwen3-32B'

export interface ChatMessage {
  role: string
  content: string
}

/**
 * Split a Qwen3 response into its reasoning block and the final reply.
 * The `<think>...</think>` block, when present, always sits at the start.
 */
export function parseThinking(content: string): { thinking: string; reply: string } {
  const match = content.match(/^<think>([\s\S]*?)<\/think>\s*/)
  if (match) return { thinking: match[1].trim(), reply: content.slice(match[0].length) }
  // Unterminated <think> (truncated or still-streaming response): keep the raw
  // reasoning out of the reply instead of leaking the opening tag + thoughts.
  if (content.startsWith('<think>')) return { thinking: content.slice('<think>'.length).trim(), reply: '' }
  return { thinking: '', reply: content }
}

/**
 * Build the chat history sent to the model. Assistant reasoning (`<think>`
 * blocks) is stripped so prior chain-of-thought is never fed back as context.
 */
export function buildHistory(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.role === 'assistant' ? parseThinking(m.content).reply : m.content,
  }))
}

/**
 * Send a chat completion to the local cocoon-runner (loopback). Returns the reply
 * content string; throws on HTTP errors or a missing/!string content field.
 * Non-streaming: the runner returns 200 with an empty body when stream:true.
 */
export async function sendChat(opts: {
  port: number
  messages: ChatMessage[]
  thinkingEnabled: boolean
  signal?: AbortSignal
}): Promise<string> {
  const apiMessages = opts.thinkingEnabled
    ? opts.messages
    : [{ role: 'system', content: '/no_think' }, ...opts.messages]

  const res = await fetch(`http://127.0.0.1:${opts.port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: DEFAULT_MODEL, messages: apiMessages, stream: false, max_tokens: 2048 }),
    signal: opts.signal,
  })

  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  const json = await res.json()
  const content = json?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('No content in response')
  return content
}
