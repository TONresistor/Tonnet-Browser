/**
 * Cocoon AI chat surface — used both by the full ton://cocoon page and the
 * sidebar. State is owned by `useCocoonChatStore`, so the conversation
 * persists when the user switches between page and sidebar within a session.
 */

import { useEffect, useRef, useState } from 'react'
import {
  ArrowUp,
  Square,
  CheckCircle2,
  LoaderCircle,
  AlertCircle,
  CircleDashed,
  Brain,
  ChevronDown,
} from 'lucide-react'
import Lottie from 'lottie-react'
import type { CocoonState } from '../../../../shared/cocoon-types'
import cocoonAnimation from '@/assets/cocoon.json'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useCocoonChatStore, selectActiveMessages, type CocoonChatMessage } from '@/stores/cocoon-chat'

const DEFAULT_MODEL = 'Qwen/Qwen3-32B'

/** Split a Qwen3 response into its reasoning block and the final reply.
 * The `<think>...</think>` block, when present, always sits at the start of
 * the response. */
function parseThinking(content: string): { thinking: string; reply: string } {
  const match = content.match(/^<think>([\s\S]*?)<\/think>\s*/)
  if (!match) return { thinking: '', reply: content }
  return { thinking: match[1].trim(), reply: content.slice(match[0].length) }
}

export interface CocoonChatProps {
  state: CocoonState
  /** Compact density for the sidebar — smaller paddings, hides the model badge. */
  compact?: boolean
  /**
   * Surfaces an auto-start failure reported by the parent session hook.
   * When set and the runner is not ready, the chat shows an actionable error
   * banner with a Retry button instead of an indefinite "Waiting…" message.
   */
  startError?: string | null
  onRetryStart?: () => void
}

export function CocoonChat({ state, compact = false, startError = null, onRetryStart }: CocoonChatProps) {
  const messages = useCocoonChatStore(selectActiveMessages)
  const addMessage = useCocoonChatStore((s) => s.addMessage)
  const updateMessage = useCocoonChatStore((s) => s.updateMessage)
  const clearMessages = useCocoonChatStore((s) => s.clearActive)
  const thinkingEnabled = useCocoonChatStore((s) => s.settings.thinkingEnabled)

  const [prompt, setPrompt] = useState('')
  const [sending, setSending] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // Only follow the tail when the user is already near the bottom — preserves
  // their scroll position if they scrolled up to read history.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [messages])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [prompt])

  const inputDisabled = state.kind !== 'ready' || sending
  const canSend = !inputDisabled && prompt.trim().length > 0

  const send = async () => {
    const text = prompt.trim()
    if (!text || state.kind !== 'ready' || sending) return

    const userMsg: CocoonChatMessage = { id: crypto.randomUUID(), role: 'user', content: text }
    const assistantId = crypto.randomUUID()
    const placeholder: CocoonChatMessage = { id: assistantId, role: 'assistant', content: '' }
    const history = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }))

    addMessage(userMsg)
    addMessage(placeholder)
    setPrompt('')
    setSending(true)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      // Non-streaming: the cocoon-runner does not forward SSE chunks (returns
      // 200 with an empty body when stream:true). Until that is fixed upstream,
      // we use a single JSON response.
      const apiMessages = thinkingEnabled ? history : [{ role: 'system', content: '/no_think' }, ...history]

      const res = await fetch(`http://127.0.0.1:${state.httpPort}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          messages: apiMessages,
          stream: false,
          max_tokens: 2048,
        }),
        signal: ctrl.signal,
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const json = await res.json()
      const content = json?.choices?.[0]?.message?.content
      if (typeof content !== 'string') throw new Error('No content in response')

      updateMessage(assistantId, { content })
    } catch (err) {
      const aborted = (err as Error).name === 'AbortError'
      const msg = aborted ? 'Cancelled.' : (err as Error).message
      updateMessage(assistantId, { content: msg, error: !aborted })
    } finally {
      setSending(false)
      abortRef.current = null
    }
  }

  const cancel = () => abortRef.current?.abort()

  const clearChat = () => {
    if (sending) return
    clearMessages()
  }

  return (
    <div className="flex flex-col h-full w-full min-h-0">
      {!compact && (
        <header className="flex items-center justify-between border-b border-border px-6 py-4">
          <span className="text-sm text-muted-foreground truncate">{DEFAULT_MODEL}</span>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <Button variant="ghost" size="sm" onClick={clearChat} disabled={sending}>
                Clear
              </Button>
            )}
            <StatusBadge state={state} verbose={false} />
          </div>
        </header>
      )}

      {state.kind === 'crashed' && (
        <div
          className={cn(
            'mt-3 p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-red-400 text-sm',
            compact ? 'mx-3' : 'mx-6'
          )}
        >
          <div className="mb-2">{state.error}</div>
          {onRetryStart && (
            <Button size="sm" variant="outline" onClick={onRetryStart} className="h-7">
              Retry
            </Button>
          )}
        </div>
      )}

      {state.kind === 'stopped' && startError && (
        <div
          className={cn(
            'mt-3 p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-red-400 text-sm',
            compact ? 'mx-3' : 'mx-6'
          )}
        >
          <div className="mb-2">{startError}</div>
          {onRetryStart && (
            <Button size="sm" variant="outline" onClick={onRetryStart} className="h-7">
              Retry
            </Button>
          )}
        </div>
      )}

      <div ref={scrollRef} className={cn('flex-1 overflow-y-auto min-h-0', compact ? 'px-2 py-3' : 'px-4 py-6')}>
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground text-center">
            {state.kind === 'ready' ? 'Type a message to start a conversation.' : 'Waiting for Cocoon to be ready…'}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {messages.map((m, i) => (
              <ChatBubble
                key={m.id}
                message={m}
                groupedWithPrev={i > 0 && messages[i - 1].role === m.role}
                pending={sending && i === messages.length - 1 && m.role === 'assistant' && !m.content}
              />
            ))}
          </ul>
        )}
      </div>

      <div
        className={cn(
          'flex items-end gap-2 rounded-2xl bg-[hsl(var(--elevation-1))] border border-border p-2',
          compact ? 'mx-2 mb-2 mt-1' : 'mx-4 mb-4 mt-2'
        )}
      >
        <textarea
          ref={textareaRef}
          className="flex-1 bg-transparent px-2 py-1.5 text-sm resize-none focus:outline-none placeholder:text-muted-foreground max-h-40"
          rows={1}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={state.kind === 'ready' ? 'Message' : 'Cocoon must be ready to chat'}
          disabled={inputDisabled}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        {sending ? (
          <Button size="icon" variant="destructive" className="h-8 w-8 shrink-0" onClick={cancel} aria-label="Cancel">
            <Square size={12} fill="currentColor" />
          </Button>
        ) : (
          <Button size="icon" className="h-8 w-8 shrink-0" onClick={send} disabled={!canSend} aria-label="Send">
            <ArrowUp size={16} strokeWidth={2.5} />
          </Button>
        )}
      </div>
    </div>
  )
}

const BUBBLE_VARIANTS = {
  user: 'bg-primary text-primary-foreground',
  assistant: 'bg-[hsl(var(--elevation-1))] text-foreground border border-border',
  error: 'bg-red-500/10 text-red-400 border border-red-500/40',
} as const

function ChatBubble({
  message,
  groupedWithPrev,
  pending,
}: {
  message: CocoonChatMessage
  groupedWithPrev: boolean
  pending: boolean
}) {
  const isUser = message.role === 'user'
  const variant: keyof typeof BUBBLE_VARIANTS = isUser ? 'user' : message.error ? 'error' : 'assistant'
  const tail = !groupedWithPrev
  const { thinking, reply } = !isUser ? parseThinking(message.content) : { thinking: '', reply: message.content }
  return (
    <li className={cn('flex', isUser ? 'justify-end' : 'justify-start', groupedWithPrev ? 'mt-0.5' : 'mt-2')}>
      <div
        className={cn(
          'max-w-[85%] text-sm break-words rounded-2xl overflow-hidden',
          BUBBLE_VARIANTS[variant],
          tail && isUser && 'rounded-br-md',
          tail && !isUser && variant === 'assistant' && 'rounded-bl-md'
        )}
      >
        {pending ? (
          <div className="px-3.5 py-2 whitespace-pre-wrap">
            <TypingDots />
          </div>
        ) : (
          <>
            {thinking && <ThinkingSection text={thinking} />}
            {reply && <div className="px-3.5 py-2 whitespace-pre-wrap">{reply}</div>}
          </>
        )}
      </div>
    </li>
  )
}

function ThinkingSection({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-border/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <Brain className="h-3.5 w-3.5" />
        <span>Thought process</span>
        <ChevronDown className={cn('ml-auto h-3 w-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="max-h-48 overflow-y-auto px-3.5 pb-2 text-xs text-muted-foreground whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  )
}

function TypingDots() {
  return <Lottie animationData={cocoonAnimation} className="h-6 w-6" loop autoplay aria-label="Thinking" />
}

const STATUS_ICONS = {
  ready: { Icon: CheckCircle2, color: 'text-green-400', spin: false },
  starting: { Icon: LoaderCircle, color: 'text-yellow-400', spin: true },
  crashed: { Icon: AlertCircle, color: 'text-red-400', spin: false },
  stopped: { Icon: CircleDashed, color: 'text-muted-foreground', spin: false },
} as const

function statusLabel(state: CocoonState): string {
  switch (state.kind) {
    case 'ready':
      return `Ready (port ${state.httpPort})`
    case 'starting':
      return `Starting: ${state.phase}`
    case 'crashed':
      return `Crashed: ${state.error}`
    case 'stopped':
      return 'Stopped'
  }
}

export function StatusBadge({ state, verbose = true }: { state: CocoonState; verbose?: boolean }) {
  const { Icon, color, spin } = STATUS_ICONS[state.kind]
  const label = statusLabel(state)
  return (
    <span
      className={cn('inline-flex items-center gap-1.5', color, !verbose && 'p-0.5')}
      title={label}
      aria-label={label}
    >
      <Icon className={cn('h-4 w-4', spin && 'animate-spin')} aria-hidden="true" />
      {verbose && <span className="text-xs">{label}</span>}
    </span>
  )
}
