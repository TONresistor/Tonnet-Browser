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

  // Apply GPU optimization hints during resize
  useEffect(() => {
    if (!panelRef.current) return

    if (isResizing) {
      // Enable GPU acceleration during resize for smooth rendering
      panelRef.current.style.willChange = 'width'
      panelRef.current.style.transform = 'translateZ(0)' // Force GPU layer
    } else {
      // Remove hints after resize to save memory
      panelRef.current.style.willChange = 'auto'
      panelRef.current.style.transform = ''
    }
  }, [isResizing])

  useEffect(() => {
    setWidth(defaultWidth)
  }, [defaultWidth])

  useEffect(() => {
    if (!isResizing) return

    let rafId: number | null = null
    let pendingWidth: number | null = null

    const handleMouseMove = (e: MouseEvent) => {
      if (!panelRef.current) return

      const newWidth = e.clientX
      const clampedWidth = Math.min(Math.max(newWidth, minWidth), maxWidth)

      // Update local state immediately for instant visual feedback
      setWidth(clampedWidth)

      // Store pending width for batched IPC update
      pendingWidth = clampedWidth

      // Schedule IPC update on next animation frame if not already scheduled
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          rafId = null
          if (pendingWidth !== null) {
            // Send batched IPC update synchronized with browser repaint
            window.electron.updateSidebarWidth(pendingWidth)
            // Call onResize for settings persistence (will be debounced separately)
            onResize(pendingWidth)
            pendingWidth = null
          }
        })
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''

      // Cancel any pending animation frame
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }

      // Send final update if there's a pending width
      if (pendingWidth !== null) {
        window.electron.updateSidebarWidth(pendingWidth)
        onResize(pendingWidth)
        pendingWidth = null
      }
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

      // Cleanup: cancel any pending animation frame
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
    }
  }, [isResizing, minWidth, maxWidth, onResize])

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }

  return (
    <div ref={panelRef} className={`relative ${className}`} style={{ width: `${width}px`, flexShrink: 0 }}>
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
