/**
 * Left rail listing Cocoon AI conversations on the full ton://cocoon page.
 * Header with the Cocoon logo, a "New chat" button, and the list of
 * conversations sorted by most recent activity.
 */

import { Plus, MessageSquare, Trash2, Brain, Wallet } from 'lucide-react'
import cocoonIcon from '@/assets/cocoon.png'
import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/settings/shared/Toggle'
import { cn } from '@/lib/utils'
import { useCocoonChatStore } from '@/stores/cocoon-chat'

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
    <aside className="w-60 shrink-0 flex flex-col h-full border-r border-border bg-[hsl(var(--elevation-1))]">
      <div className="px-4 py-4 border-b border-border flex items-center justify-center gap-2">
        <img src={cocoonIcon} alt="" className="h-5 w-5 brightness-0 invert" />
        <span className="text-xl font-bold text-foreground">Cocoon Ai</span>
      </div>

      <div className="px-3 pt-3">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => {
            newConversation()
            onSelectChat?.()
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          New chat
        </Button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3 min-h-0">
        {sorted.length === 0 ? (
          <p className="text-xs text-muted-foreground px-2 py-4 text-center">No conversations yet.</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {sorted.map((c) => (
              <li key={c.id} className="group relative">
                <button
                  type="button"
                  onClick={() => {
                    selectConversation(c.id)
                    onSelectChat?.()
                  }}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-2 rounded-md text-left text-sm transition-colors',
                    'hover:bg-accent/40',
                    activeView === 'chat' && c.id === activeId
                      ? 'bg-accent/60 text-foreground'
                      : 'text-muted-foreground'
                  )}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate flex-1">{c.title}</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteConversation(c.id)
                  }}
                  aria-label="Delete conversation"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded
                    text-muted-foreground hover:text-red-400 hover:bg-red-500/10
                    opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>

      <div className="border-t border-border px-3 py-3 shrink-0 space-y-3">
        <button
          type="button"
          onClick={onSelectWallet}
          aria-pressed={activeView === 'wallet'}
          className={cn(
            'w-full flex items-center gap-2 px-2 py-2 rounded-md text-left text-sm transition-colors',
            'hover:bg-accent/40',
            activeView === 'wallet' ? 'bg-accent/60 text-foreground' : 'text-muted-foreground'
          )}
        >
          <Wallet className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Cocoon Wallet</span>
        </button>
        <label className="flex items-center justify-between gap-2 cursor-pointer select-none">
          <span className="flex items-center gap-2">
            <Brain className={cn('h-3.5 w-3.5', thinkingEnabled ? 'text-primary' : 'text-muted-foreground')} />
            <span className={cn('text-xs', thinkingEnabled ? 'text-foreground' : 'text-muted-foreground')}>Think</span>
          </span>
          <Toggle checked={thinkingEnabled} onChange={setThinking} label="Toggle thinking" />
        </label>
      </div>
    </aside>
  )
}
