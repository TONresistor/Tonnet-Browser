import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 text-center', className)}>
      {icon && (
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface text-muted-foreground">
          {icon}
        </div>
      )}
      <div>
        <p className="text-[15px] font-semibold text-foreground">{title}</p>
        {description && <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}
