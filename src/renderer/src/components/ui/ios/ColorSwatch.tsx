import { cn } from '@/lib/utils'

interface ColorSwatchProps {
  color: string
  size?: 'sm' | 'md'
  selected?: boolean
  className?: string
}

const SIZES = {
  sm: 'h-7 w-7',
  md: 'h-8 w-8',
} as const

export function ColorSwatch({ color, size = 'sm', selected = false, className }: ColorSwatchProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative inline-flex shrink-0 rounded-full border border-border-medium shadow-sm',
        "after:absolute after:inset-[2px] after:rounded-full after:border after:border-border-subtle after:content-['']",
        SIZES[size],
        selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background-secondary',
        className
      )}
      style={{ backgroundColor: color }}
    />
  )
}
