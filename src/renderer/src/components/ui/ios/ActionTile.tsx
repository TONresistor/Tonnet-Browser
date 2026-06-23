import { cn } from '@/lib/utils'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface ActionTileProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode
  label: string
}

export function ActionTile({ icon, label, className, type, ...props }: ActionTileProps) {
  return (
    <button
      type={type ?? 'button'}
      className={cn(
        'flex w-[92px] flex-col items-center justify-center gap-1.5 rounded-[20px] bg-elevation-2 py-3.5 transition-colors duration-150 hover:bg-elevation-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        className
      )}
      {...props}
    >
      <span className="text-primary">{icon}</span>
      <span className="text-[13px] font-medium text-foreground">{label}</span>
    </button>
  )
}
