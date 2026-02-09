/**
 * Groupe de toggles (sélecteur de mode)
 */

import { cn } from '@/lib/utils'

interface ToggleGroupProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string; icon?: React.ReactNode }[]
  disabled?: boolean
}

export function ToggleGroup<T extends string>({ value, onChange, options, disabled }: ToggleGroupProps<T>) {
  return (
    <div className="inline-flex rounded-full border border-border-medium bg-surface-hover p-0.5">
      {options.map((option, index) => (
        <button
          key={option.value}
          onClick={() => !disabled && onChange(option.value)}
          disabled={disabled}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1 text-sm font-medium transition-all duration-200 disabled:opacity-50',
            index === 0 && 'rounded-l-full',
            index === options.length - 1 && 'rounded-r-full',
            value === option.value
              ? 'bg-primary text-primary-foreground rounded-full shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  )
}
