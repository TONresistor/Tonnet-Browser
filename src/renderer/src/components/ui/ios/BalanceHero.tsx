import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface BalanceHeroProps {
  amount: string
  unit?: string
  size?: 'lg' | 'xl'
  children?: ReactNode
  className?: string
}

export function BalanceHero({ amount, unit = 'GRAM', size = 'xl', children, className }: BalanceHeroProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 text-center', className)}>
      <p
        className={cn(
          'font-bold tracking-tight tabular-nums text-foreground',
          size === 'xl' ? 'text-[40px] leading-none' : 'text-3xl leading-none'
        )}
      >
        {amount}
        {unit && (
          <span className={cn('ml-1.5 font-semibold text-muted-foreground', size === 'xl' ? 'text-2xl' : 'text-lg')}>
            {unit}
          </span>
        )}
      </p>
      {children}
    </div>
  )
}
