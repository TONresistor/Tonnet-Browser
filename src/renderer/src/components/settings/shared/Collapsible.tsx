/**
 * Section repliable (dropdown) — style iOS : header tappable (titre + chevron rotatif)
 * qui révèle/masque son contenu.
 */

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CollapsibleProps {
  title: string
  description?: string
  defaultOpen?: boolean
  children: React.ReactNode
}

export function Collapsible({ title, description, defaultOpen = false, children }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="settings-group flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-hover"
      >
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-foreground">{title}</p>
          {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
        </div>
        <ChevronRight
          className={cn(
            'h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200',
            open && 'rotate-90'
          )}
        />
      </button>
      {open && <div className="mt-3 space-y-6">{children}</div>}
    </div>
  )
}
