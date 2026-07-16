import type { WebContentsView } from 'electron'
import { PAGE_ZOOM } from '../../shared/constants'

export class PageZoomController {
  private defaultZoomPercent: number

  constructor(defaultZoom: number) {
    this.defaultZoomPercent = this.clamp(defaultZoom)
  }

  get defaultZoom(): number {
    return this.defaultZoomPercent
  }

  setDefaultZoom(defaultZoom: number): number {
    this.defaultZoomPercent = this.clamp(defaultZoom)
    return this.defaultZoomPercent
  }

  zoomIn(view: WebContentsView | null): boolean {
    return this.adjust(view, PAGE_ZOOM.STEP_PERCENT)
  }

  zoomOut(view: WebContentsView | null): boolean {
    return this.adjust(view, -PAGE_ZOOM.STEP_PERCENT)
  }

  reset(view: WebContentsView | null): boolean {
    if (!view) return false
    view.webContents.setZoomFactor(this.defaultZoomPercent / 100)
    return true
  }

  handleInput(input: Electron.Input, view: WebContentsView | null): boolean {
    if (process.platform === 'darwin' || input.type !== 'keyDown' || !input.control || input.alt) return false
    if (input.key === '+' || input.key === '=') {
      this.zoomIn(view)
      return true
    }
    if (input.key === '-') {
      this.zoomOut(view)
      return true
    }
    if (input.key === '0') {
      this.reset(view)
      return true
    }
    return false
  }

  private adjust(view: WebContentsView | null, deltaPercent: number): boolean {
    if (!view) return false
    const currentPercent = Math.round(view.webContents.getZoomFactor() * 100)
    view.webContents.setZoomFactor(this.clamp(currentPercent + deltaPercent) / 100)
    return true
  }

  private clamp(percent: number): number {
    return Math.min(Math.max(percent, PAGE_ZOOM.MIN_PERCENT), PAGE_ZOOM.MAX_PERCENT)
  }
}
