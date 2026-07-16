import { useEffect, useState } from 'react'
import { hexToHsl, hslToHex } from '@/lib/theme-utils'
import { ColorSwatch } from '@/components/ui/ios/ColorSwatch'
import { InfoTooltip } from '@/components/ui/ios/InfoTooltip'

interface ThemeColorFieldProps {
  label: string
  description?: string
  value: string
  disabled?: boolean
  readOnly?: boolean
  onChange?: (value: string) => void
}

export function ThemeColorField({
  label,
  description,
  value,
  disabled = false,
  readOnly = false,
  onChange,
}: ThemeColorFieldProps) {
  const hex = hslToHex(value).toUpperCase()
  const [text, setText] = useState(hex)
  const [invalid, setInvalid] = useState(false)

  useEffect(() => {
    setText(hex)
    setInvalid(false)
  }, [hex])

  const commitText = () => {
    if (/^#[0-9A-F]{6}$/i.test(text)) {
      setInvalid(false)
      if (!readOnly && text.toUpperCase() !== hex) onChange?.(hexToHsl(text))
      return
    }
    setInvalid(true)
  }

  return (
    <div className={`flex min-h-[52px] min-w-0 items-center gap-3 px-4 py-2 ${disabled ? 'opacity-60' : ''}`}>
      {readOnly ? (
        <span className="relative block h-7 w-7 shrink-0 rounded-full" aria-hidden="true">
          <ColorSwatch color={hex} />
        </span>
      ) : (
        <label className="group relative block h-7 w-7 shrink-0 cursor-pointer rounded-full">
          <input
            type="color"
            value={hex}
            disabled={disabled}
            onChange={(event) => {
              if (event.target.value.toUpperCase() !== hex) onChange?.(hexToHsl(event.target.value))
            }}
            className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label={label}
          />
          <ColorSwatch
            color={hex}
            className="peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-elevation-2"
          />
        </label>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <p className="truncate text-sm font-medium text-foreground">{label}</p>
        {description && <InfoTooltip label={label} content={description} />}
      </div>
      <div className="relative w-[92px] shrink-0">
        <input
          value={text}
          disabled={disabled}
          readOnly={readOnly}
          onChange={(event) => {
            if (readOnly) return
            setText(event.target.value.toUpperCase())
            setInvalid(false)
          }}
          onBlur={() => {
            if (!readOnly) commitText()
          }}
          onKeyDown={(event) => {
            if (readOnly) return
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              event.preventDefault()
              setText(hex)
              setInvalid(false)
            }
          }}
          className={`w-full rounded-full border bg-elevation-1 px-3 py-1.5 text-right font-mono text-xs text-foreground outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed ${
            invalid ? 'border-destructive' : 'border-border-medium'
          }`}
          aria-label={`${label} HEX`}
          aria-invalid={invalid}
        />
      </div>
    </div>
  )
}
