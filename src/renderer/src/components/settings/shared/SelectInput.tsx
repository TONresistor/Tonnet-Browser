/**
 * Select input réutilisable
 */

interface SelectInputProps {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}

export function SelectInput({ value, onChange, options }: SelectInputProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="pl-4 pr-8 py-1.5 rounded-full text-sm text-foreground outline-none cursor-pointer bg-surface-hover border border-border-medium"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value} className="bg-background text-foreground">
          {opt.label}
        </option>
      ))}
    </select>
  )
}
