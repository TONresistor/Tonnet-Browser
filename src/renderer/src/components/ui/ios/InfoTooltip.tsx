import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type SVGProps } from 'react'
import { createPortal } from 'react-dom'
import { clampToViewport } from '@/lib/overlay-position'
import { cn } from '@/lib/utils'

const TOOLTIP_GAP = 8
const VIEWPORT_PADDING = 8

export function InfoCircleFillIcon(props: SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      data-figma-node-id="6398:8654"
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M14 25C20.0751 25 25 20.0751 25 14C25 7.92487 20.0751 3 14 3C7.92487 3 3 7.92487 3 14C3 20.0751 7.92487 25 14 25ZM15.25 8.75001C15.25 9.44037 14.6904 10 14 10C13.3096 10 12.75 9.44037 12.75 8.75001C12.75 8.05965 13.3096 7.50001 14 7.50001C14.6904 7.50001 15.25 8.05965 15.25 8.75001ZM11.165 12.5C11.165 12.0388 11.5389 11.665 12 11.665H14.25C14.7112 11.665 15.085 12.0388 15.085 12.5V18.665H16.5C16.9612 18.665 17.335 19.0388 17.335 19.5C17.335 19.9612 16.9612 20.335 16.5 20.335H12C11.5389 20.335 11.165 19.9612 11.165 19.5C11.165 19.0388 11.5389 18.665 12 18.665H13.415V13.335H12C11.5389 13.335 11.165 12.9612 11.165 12.5Z"
        fill="currentColor"
      />
    </svg>
  )
}

interface InfoTooltipProps {
  label: string
  content: string
  className?: string
}

export function InfoTooltip({ label, content, className }: InfoTooltipProps) {
  const tooltipId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const open = hovered || focused

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    const tooltip = tooltipRef.current
    if (!trigger || !tooltip) return

    const triggerRect = trigger.getBoundingClientRect()
    const tooltipRect = tooltip.getBoundingClientRect()
    const x = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2
    const below = triggerRect.bottom + TOOLTIP_GAP
    const y =
      below + tooltipRect.height <= window.innerHeight - VIEWPORT_PADDING
        ? below
        : triggerRect.top - tooltipRect.height - TOOLTIP_GAP

    setPosition(clampToViewport(x, y, tooltipRect.width, tooltipRect.height, VIEWPORT_PADDING))
  }, [])

  useLayoutEffect(() => {
    if (open) updatePosition()
  }, [content, open, updatePosition])

  useEffect(() => {
    if (!open) return
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, updatePosition])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-icon/60 transition-colors',
          'hover:text-icon/80 focus-visible:text-icon/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className
        )}
        aria-label={`${label}: ${content}`}
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') event.currentTarget.blur()
        }}
      >
        <InfoCircleFillIcon className="h-4 w-4" />
      </button>

      {open &&
        createPortal(
          <div
            ref={tooltipRef}
            id={tooltipId}
            role="tooltip"
            className="pointer-events-none fixed z-[200] w-max max-w-[300px] rounded-card border border-border-subtle bg-elevation-4/95 px-3 py-2 text-xs leading-relaxed text-foreground shadow-panel backdrop-blur-xl"
            style={{
              left: position?.x ?? 0,
              top: position?.y ?? 0,
              visibility: position ? 'visible' : 'hidden',
            }}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  )
}
