/**
 * Resizable panel component with drag handle
 * Allows users to resize the sidebar by dragging the right edge
 */

import { useState, useRef, useEffect, ReactNode } from 'react'

interface ResizablePanelProps {
  children: ReactNode
  defaultWidth: number
  minWidth: number
  maxWidth: number
  onResize: (width: number) => void
  className?: string
}

export function ResizablePanel({
  children,
  defaultWidth,
  minWidth,
  maxWidth,
  onResize,
  className = '',
}: ResizablePanelProps) {
  const [width, setWidth] = useState(defaultWidth)
  const [isResizing, setIsResizing] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setWidth(defaultWidth)
  }, [defaultWidth])

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!panelRef.current) return

      const newWidth = e.clientX
      const clampedWidth = Math.min(Math.max(newWidth, minWidth), maxWidth)

      setWidth(clampedWidth)
      onResize(clampedWidth)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing, minWidth, maxWidth, onResize])

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }

  return (
    <div
      ref={panelRef}
      className={`relative ${className}`}
      style={{ width: `${width}px`, flexShrink: 0 }}
    >
      {children}

      {/* Resize handle */}
      <div
        className="absolute top-0 right-0 bottom-0 w-1 cursor-ew-resize hover:bg-primary/50 transition-colors group"
        onMouseDown={handleMouseDown}
      >
        {/* Wider invisible hit area for easier grabbing */}
        <div className="absolute inset-y-0 -left-1 -right-1" />
      </div>
    </div>
  )
}
