/**
 * Geometry helpers for positioning context menus and popovers.
 */

const VIEWPORT_PADDING = 4

/**
 * Clamp a desired overlay origin so the box stays fully inside the window,
 * keeping `padding` px from each edge. Pass the already-offset desired x/y
 * (e.g. centered or below-cursor); this only performs the viewport clamp.
 */
export function clampToViewport(
  x: number,
  y: number,
  width: number,
  height: number,
  padding = VIEWPORT_PADDING
): { x: number; y: number } {
  return {
    x: Math.max(padding, Math.min(x, window.innerWidth - width - padding)),
    y: Math.max(padding, Math.min(y, window.innerHeight - height - padding)),
  }
}
