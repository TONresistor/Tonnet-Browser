/**
 * Cocoon AI chat surface — used both by the full ton://cocoon page and the
 * sidebar. State is owned by `useCocoonChatStore`, so the conversation
 * persists when the user switches between page and sidebar within a session.
 */

import { errorMessage } from '@shared/errors'
import { useEffect, useRef, useState, memo } from 'react'
import { ArrowUp, Square, Brain, ChevronDown, Trash2 } from 'lucide-react'
import Lottie from 'lottie-react'
import type { CocoonState } from '../../../../shared/cocoon-types'
import cocoonAnimation from '@/assets/cocoon.json'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useCocoonChatStore, selectActiveMessages, type CocoonChatMessage } from '@/stores/cocoon-chat'
import { DEFAULT_MODEL, parseThinking, buildHistory, sendChat } from '@/lib/cocoon-llm'
import { ChatMarkdown } from './ChatMarkdown'

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
    const history = buildHistory([...messages, userMsg].map((m) => ({ role: m.role, content: m.content })))

    addMessage(userMsg)
    addMessage(placeholder)
    setPrompt('')
    setSending(true)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const content = await sendChat({
        port: state.httpPort,
        messages: history,
        thinkingEnabled,
        signal: ctrl.signal,
      })
      updateMessage(assistantId, { content })
    } catch (err) {
      const aborted = (err as Error).name === 'AbortError'
      const msg = aborted ? 'Cancelled.' : errorMessage(err)
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
    <div className="relative flex h-full w-full min-h-0 flex-col">
      {/* Floating header — model + clear as pills; messages scroll beneath. */}
      {!compact && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-20 backdrop-blur-md [mask-image:linear-gradient(to_bottom,black_55%,transparent)] [-webkit-mask-image:linear-gradient(to_bottom,black_55%,transparent)]"
          />
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 px-4 pt-4">
            {/* Model pill — future: opens a model selector */}
            <button
              type="button"
              title={DEFAULT_MODEL}
              className="pointer-events-auto inline-flex max-w-[60%] items-center gap-1.5 rounded-full border border-border-subtle bg-elevation-2 px-3 py-1.5 text-sm font-medium text-foreground shadow-panel transition-colors hover:bg-surface-hover"
            >
              <span className="truncate">{DEFAULT_MODEL}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={clearChat}
                disabled={sending}
                className="pointer-events-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border-subtle bg-elevation-2 px-3 py-1.5 text-sm font-medium text-foreground shadow-panel transition-colors hover:bg-surface-hover disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear
              </button>
            )}
          </div>
        </>
      )}

      {/* Scroll area — top/bottom padding clears the floating header + write bar. */}
      <div
        ref={scrollRef}
        className={cn('min-h-0 flex-1 overflow-y-auto', compact ? 'px-2 pb-20 pt-3' : 'px-4 pb-24 pt-16')}
      >
        {state.kind === 'crashed' && (
          <div className="mb-2 rounded-card border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <div className="mb-2">{state.error}</div>
            {onRetryStart && (
              <Button size="sm" variant="outline" onClick={onRetryStart} className="h-7">
                Retry
              </Button>
            )}
          </div>
        )}
        {state.kind === 'stopped' && startError && (
          <div className="mb-2 rounded-card border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <div className="mb-2">{startError}</div>
            {onRetryStart && (
              <Button size="sm" variant="outline" onClick={onRetryStart} className="h-7">
                Retry
              </Button>
            )}
          </div>
        )}

        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
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

      {/* Progressive blur — confined to the write-bar level (where text slides under
          it), with a short fade at the top edge. Doesn't blur readable messages above. */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 backdrop-blur-md',
          '[mask-image:linear-gradient(to_top,black_60%,transparent)]',
          '[-webkit-mask-image:linear-gradient(to_top,black_60%,transparent)]',
          compact ? 'h-16' : 'h-20'
        )}
      />

      {/* Floating write bar — same shadow as the sidebar; messages scroll beneath it. */}
      <div className={cn('pointer-events-none absolute inset-x-0 bottom-0', compact ? 'px-2 pb-2' : 'px-4 pb-4')}>
        <div className="pointer-events-auto flex items-end gap-2 rounded-full border border-border-subtle bg-elevation-2 p-2 shadow-panel">
          <textarea
            ref={textareaRef}
            className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none"
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
    </div>
  )
}

const BUBBLE_VARIANTS = {
  user: 'bg-primary text-primary-foreground',
  assistant: 'bg-[hsl(var(--elevation-1))] text-foreground border border-border',
  error: 'bg-red-500/10 text-red-400 border border-red-500/40',
} as const

const ChatBubble = memo(function ChatBubble({
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
            {reply && (
              <div className="px-3.5 py-2">
                {isUser || message.error ? (
                  <span className="whitespace-pre-wrap">{reply}</span>
                ) : (
                  <ChatMarkdown content={reply} />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </li>
  )
})

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
