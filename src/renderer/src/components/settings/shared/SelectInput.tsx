/**
 * Select réutilisable — style iOS (valeur + chevrons up/down).
 */

import { ChevronsUpDown } from 'lucide-react'

interface SelectInputProps {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}

export function SelectInput({ value, onChange, options }: SelectInputProps) {
  return (
    <div className="relative inline-flex items-center">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 cursor-pointer appearance-none rounded-field bg-surface py-1 pl-3 pr-8 text-sm text-foreground outline-none"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-background text-foreground">
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronsUpDown className="pointer-events-none absolute right-2 h-4 w-4 text-muted-foreground" />
    </div>
  )
}
