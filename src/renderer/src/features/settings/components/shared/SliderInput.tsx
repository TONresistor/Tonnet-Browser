/**
 * Input range réutilisable avec style iOS/TON
 */

import { useEffect } from 'react'

interface SliderInputProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
}

const SLIDER_STYLE_ID = 'slider-input-styles'
const SLIDER_CSS = `
.slider-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: hsl(var(--switch-thumb));
  box-shadow: var(--shadow-control);
  cursor: pointer;
  margin-top: -8px;
}
.slider-input::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 9999px;
  border: none;
}
.slider-input::-moz-range-thumb {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: hsl(var(--switch-thumb));
  box-shadow: var(--shadow-control);
  cursor: pointer;
  border: none;
}
`

function useSliderStyles() {
  useEffect(() => {
    if (document.getElementById(SLIDER_STYLE_ID)) return
    const style = document.createElement('style')
    style.id = SLIDER_STYLE_ID
    style.textContent = SLIDER_CSS
    document.head.appendChild(style)
  }, [])
}

export function SliderInput({ value, onChange, min = 0, max = 100, step = 1, suffix }: SliderInputProps) {
  useSliderStyles()
  const pct = Math.round(((value - min) / (max - min)) * 100)
  const fill = `hsl(var(--primary))`
  const track = `hsl(var(--border) / 0.5)`
  const bg = `linear-gradient(to right, ${fill} ${pct}%, ${track} ${pct}%)`

  return (
    <div className="flex items-center gap-3 w-48">
      <input
        type="range"
        className="slider-input flex-1 h-1 rounded-full outline-none appearance-none cursor-pointer"
        style={{ background: bg }}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
      />
      <span className="text-xs text-muted-foreground bg-surface-hover px-2 py-0.5 rounded-full min-w-[3rem] text-center tabular-nums">
        {value}
        {suffix}
      </span>
    </div>
  )
}
