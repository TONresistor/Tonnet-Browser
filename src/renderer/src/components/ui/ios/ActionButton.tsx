import { cn } from '@/lib/utils'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ActionVariant = 'filled' | 'tinted' | 'gray'

const VARIANTS: Record<ActionVariant, string> = {
  filled: 'bg-primary text-identity-foreground hover:bg-primary/90',
  tinted: 'bg-[hsl(var(--primary)/0.14)] text-primary hover:bg-[hsl(var(--primary)/0.22)]',
  gray: 'bg-surface-hover text-foreground border border-border-medium hover:bg-surface-active',
}

interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ActionVariant
  icon?: ReactNode
}

export function ActionButton({ variant = 'tinted', icon, className, children, type, ...props }: ActionButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      className={cn(
        'inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-[15px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        VARIANTS[variant],
        className
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  )
}
