/**
 * Sélecteur de mode — style iOS segmented control (pilule élevée neutre pour l'option active).
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
    <div className="inline-flex rounded-segment bg-surface p-[2px]">
      {options.map((option) => {
        const selected = value === option.value
        return (
          <button
            key={option.value}
            onClick={() => !disabled && onChange(option.value)}
            disabled={disabled}
            className={cn(
              'flex items-center gap-1.5 rounded-control px-3 py-1 text-[13px] font-medium transition-all duration-200 disabled:opacity-50',
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
