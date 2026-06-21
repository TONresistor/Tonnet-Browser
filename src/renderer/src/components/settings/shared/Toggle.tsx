/**
 * Switch réutilisable — reproduit à l'identique du composant "Toggle - Switch" du
 * Telegram iOS UI Kit (Figma node 6028:3502) : track 64×28 rounded-full overflow-clip,
 * knob blanc 39×24 rounded-full inset 2px. Le ON utilise le bleu TON (theme primary)
 * au lieu du vert iOS du kit (#34c759).
 */

import { cn } from '@/lib/utils'

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}

export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-[28px] w-[64px] shrink-0 overflow-hidden rounded-full transition-colors duration-200 ease-out',
        checked ? 'bg-primary' : 'bg-[rgba(120,120,120,0.2)]',
        disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-[2px] top-1/2 h-[24px] w-[39px] -translate-y-1/2 rounded-full bg-white transition-transform duration-200 ease-out',
          checked && 'translate-x-[21px]'
        )}
      />
    </button>
  )
}
