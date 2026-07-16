import { cn } from '@/lib/utils'
import type { KeyboardEvent, ReactNode } from 'react'

interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
}

interface SegmentedProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: SegmentedOption<T>[]
  disabled?: boolean
  fullWidth?: boolean
  ariaLabel: string
  className?: string
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  disabled,
  fullWidth,
  ariaLabel,
  className,
}: SegmentedProps<T>) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return

    event.preventDefault()
    const currentIndex = options.findIndex((option) => option.value === value)
    let nextIndex = currentIndex
    if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = options.length - 1
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % options.length
    else nextIndex = (currentIndex - 1 + options.length) % options.length

    const nextOption = options[nextIndex]
    if (!nextOption) return
    onChange(nextOption.value)
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled}
      onKeyDown={handleKeyDown}
      className={cn('inline-flex rounded-segment bg-surface p-[2px]', fullWidth && 'flex w-full', className)}
    >
      {options.map((option) => {
        const selected = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => !disabled && onChange(option.value)}
            disabled={disabled}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-control px-3 py-1 text-[13px] font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:opacity-50',
              fullWidth && 'flex-1',
              selected ? 'bg-elevation-4 text-foreground shadow-control' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {option.icon}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
