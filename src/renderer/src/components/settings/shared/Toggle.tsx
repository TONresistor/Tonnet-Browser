/**
 * Composant Toggle réutilisable
 */

import { cn } from '@/lib/utils'

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}

export function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'w-11 h-6 rounded-full transition-colors relative border-2',
        checked ? 'bg-primary border-primary' : 'bg-border/50 border-border'
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-all duration-200',
          checked ? 'left-5 bg-primary-foreground' : 'bg-foreground'
        )}
      />
    </button>
  )
}
