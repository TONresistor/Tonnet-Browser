/**
 * Left rail listing Cocoon AI conversations on the full ton://cocoon page.
 * Floating detached card (same language as the storage / settings sidebars):
 * logo header, a "New chat" action, the conversation list, and a footer with
 * the Cocoon Wallet view toggle + the Think switch.
 */

import { Brain, Plus, Trash2, Wallet } from 'lucide-react'
import cocoonIcon from '@/assets/cocoon.png'
import { ActionButton } from '@/components/ui/ios/ActionButton'
import { Toggle } from '@/features/settings/components/shared/Toggle'
import { cn } from '@/lib/utils'
import { useCocoonChatStore } from '@/features/cocoon/store'
import { conversationPreview, relativeTime } from './chat-list'

type CocoonRailView = 'chat' | 'wallet'

interface CocoonConversationsRailProps {
  activeView?: CocoonRailView
  onSelectChat?: () => void
  onSelectWallet?: () => void
}

export function CocoonConversationsRail({
  activeView = 'chat',
  onSelectChat,
  onSelectWallet,
}: CocoonConversationsRailProps) {
  const conversations = useCocoonChatStore((s) => s.conversations)
  const activeId = useCocoonChatStore((s) => s.activeId)
  const newConversation = useCocoonChatStore((s) => s.newConversation)
  const selectConversation = useCocoonChatStore((s) => s.selectConversation)
  const deleteConversation = useCocoonChatStore((s) => s.deleteConversation)
  const thinkingEnabled = useCocoonChatStore((s) => s.settings.thinkingEnabled)
  const setThinking = useCocoonChatStore((s) => s.setThinking)

  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <aside className="m-3 flex w-[260px] shrink-0 flex-col overflow-hidden rounded-panel border border-border-subtle bg-elevation-1 shadow-panel">
      <div className="flex items-center justify-center gap-2 px-4 pb-3 pt-4">
        <img src={cocoonIcon} alt="" className="h-5 w-5 brightness-0 invert" />
        <span className="text-xl font-bold text-foreground">Cocoon Ai</span>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {sorted.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">No conversations yet.</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {sorted.map((c) => {
              const active = activeView === 'chat' && c.id === activeId
              return (
                <li key={c.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => {
                      selectConversation(c.id)
                      onSelectChat?.()
                    }}
                    className={cn(
                      'flex w-full flex-col gap-0.5 rounded-control px-2.5 py-2 text-left transition-colors',
                      active ? 'bg-[hsl(var(--primary)/0.14)]' : 'hover:bg-surface-hover'
                    )}
                  >
                    <span className="flex w-full items-baseline gap-2">
                      <span className="flex-1 truncate text-[14px] font-medium text-foreground">{c.title}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                        {relativeTime(c.updatedAt, Date.now())}
                      </span>
                    </span>
                    <span className="block w-full truncate text-xs text-muted-foreground">
                      {conversationPreview(c)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteConversation(c.id)
                    }}
                    aria-label="Delete conversation"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-elevation-2 p-1.5 text-muted-foreground
                      opacity-0 shadow-sm transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </nav>

      <div className="shrink-0 px-3 pb-2 pt-1">
        <ActionButton
          variant="gray"
          className="w-full"
          icon={<Plus className="h-4 w-4" />}
          onClick={() => {
            newConversation()
            onSelectChat?.()
          }}
        >
          New chat
        </ActionButton>
      </div>

      <div className="shrink-0 space-y-1 border-t border-border-subtle px-2 py-2">
        <button
          type="button"
          onClick={onSelectWallet}
          aria-pressed={activeView === 'wallet'}
          className={cn(
            'flex w-full items-center gap-2 rounded-control px-2 py-2 text-left text-sm transition-colors',
            activeView === 'wallet'
              ? 'bg-[hsl(var(--primary)/0.14)] text-foreground'
              : 'text-muted-foreground hover:bg-surface-hover'
          )}
        >
          <Wallet className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Cocoon Wallet</span>
        </button>
        <label className="flex cursor-pointer select-none items-center justify-between gap-2 px-2 py-1">
          <span className="flex items-center gap-2">
            <Brain className={cn('h-3.5 w-3.5', thinkingEnabled ? 'text-primary' : 'text-muted-foreground')} />
            <span className={cn('text-xs', thinkingEnabled ? 'text-foreground' : 'text-muted-foreground')}>Think</span>
          </span>
          <Toggle checked={thinkingEnabled} onChange={setThinking} ariaLabel="Toggle thinking" />
        </label>
      </div>
    </aside>
  )
}
