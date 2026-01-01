/**
 * Color input component with color picker and HSL display.
 */

import { hslToHex, hexToHsl } from '../../lib/theme-utils'

interface ColorInputProps {
  label: string
  description?: string
  value: string // HSL string "H S% L%"
  onChange: (value: string) => void
}

export function ColorInput({ label, description, value, onChange }: ColorInputProps) {
  const hex = hslToHex(value)

  return (
    <div className="flex items-center gap-3">
      <label className="relative block cursor-pointer">
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(hexToHsl(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        <div
          className="w-10 h-10 rounded-md border border-border-medium"
          style={{ backgroundColor: hex }}
        />
      </label>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{label}</p>
        {description && (
          <p className="text-xs text-muted-foreground truncate">{description}</p>
        )}
        <p className="text-xs text-foreground-muted font-mono">{value}</p>
      </div>
    </div>
  )
}

export default ColorInput
