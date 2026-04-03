/**
 * Overlay manager for native WebContentsView overlays.
 * Manages a pool of transparent views stacked above web content.
 */

import { WebContentsView, BrowserWindow } from 'electron'
import { join } from 'path'
import { createLogger } from '../../shared/logger'

const log = createLogger('overlay')

type OverlayActionHandler = (actionType: string, actionData: unknown) => void

interface OverlayOptions {
  /** If true (default), overlay auto-dismisses on blur (click outside). Set false for suggestion-style overlays. */
  autoDismiss?: boolean
}

interface OverlayInstance {
  view: WebContentsView
  id: string
  onAction?: OverlayActionHandler
  autoDismiss: boolean
}

interface OverlayBounds {
  x: number
  y: number
  width: number
  height: number
}

type OverlayContent = { type: string; [key: string]: unknown }

class OverlayManager {
  private mainWindow: BrowserWindow | null = null
  private pool: WebContentsView[] = []
  private active = new Map<string, OverlayInstance>()
  private readonly POOL_SIZE = 2
  private resizeHandler: (() => void) | null = null
  private clickOutsideHandlers = new Map<string, () => void>()

  init(win: BrowserWindow): void {
    this.mainWindow = win

    for (let i = 0; i < this.POOL_SIZE; i++) {
      this.pool.push(this.createOverlayView())
    }

    // Hide all overlays on window resize (bounds become invalid)
    this.resizeHandler = () => this.hideAll()
    this.mainWindow.on('resize', this.resizeHandler)

    log.info(`Overlay manager initialized with pool of ${this.POOL_SIZE}`)
  }

  private createOverlayView(): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../../resources/overlay/overlay-preload.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    view.setBackgroundColor('#00000000')

    const htmlPath = join(__dirname, '../../resources/overlay/overlay.html')
    view.webContents.loadFile(htmlPath).catch((err) => {
      log.error('Failed to load overlay HTML:', err)
    })

    return view
  }

  show(
    id: string,
    bounds: OverlayBounds,
    content: OverlayContent,
    onAction?: OverlayActionHandler,
    options?: OverlayOptions
  ): void {
    if (!this.mainWindow) return
    const autoDismiss = options?.autoDismiss !== false

    // Reuse existing overlay with same id (transitions like menu -> form)
    const existing = this.active.get(id)
    if (existing) {
      existing.view.setBounds(bounds)
      existing.view.webContents.send('overlay:content', content)
      if (onAction) existing.onAction = onAction
      try {
        this.mainWindow.contentView.addChildView(existing.view)
      } catch {
        // Already attached
      }
      if (autoDismiss) existing.view.webContents.focus()
      return
    }

    // Get a view from pool or create one
    let view = this.pool.pop()
    if (!view) {
      view = this.createOverlayView()
      log.warn('Pool empty, created overlay on-demand')
    }

    view.setBounds(bounds)
    this.mainWindow.contentView.addChildView(view)
    view.webContents.send('overlay:content', content)

    this.active.set(id, { view, id, onAction, autoDismiss })

    if (autoDismiss) {
      view.webContents.focus()
      this.setupClickOutside(id)
    }

    log.info(`Overlay shown: ${id}`)
  }

  private setupClickOutside(id: string): void {
    const instance = this.active.get(id)
    if (!instance) return

    const handler = (): void => {
      setTimeout(() => {
        if (this.active.has(id)) {
          this.emitDismiss(id)
        }
      }, 50)
    }

    // Delay listener registration to let focus stabilize after show+focus
    const setupTimer = setTimeout(() => {
      if (!this.active.has(id)) return
      instance.view.webContents.on('blur', handler)
    }, 200)

    this.clickOutsideHandlers.set(id, () => {
      clearTimeout(setupTimer)
      instance.view.webContents.removeListener('blur', handler)
    })
  }

  private emitDismiss(id: string): void {
    if (!this.mainWindow) return
    this.mainWindow.webContents.send('overlay:action', id, 'dismiss', {})
    this.hide(id)
  }

  hide(id: string): void {
    const instance = this.active.get(id)
    if (!instance || !this.mainWindow) return

    // Cleanup click-outside handler
    const cleanupHandler = this.clickOutsideHandlers.get(id)
    if (cleanupHandler) {
      cleanupHandler()
      this.clickOutsideHandlers.delete(id)
    }

    try {
      this.mainWindow.contentView.removeChildView(instance.view)
    } catch {
      // View may already be detached
    }

    // Clear content and return to pool
    instance.view.webContents.send('overlay:content', null)
    this.pool.push(instance.view)
    this.active.delete(id)
    log.info(`Overlay hidden: ${id}`)
  }

  hideAll(): void {
    for (const id of this.active.keys()) {
      this.hide(id)
    }
  }

  updateBounds(id: string, bounds: OverlayBounds): void {
    const instance = this.active.get(id)
    if (!instance) return
    instance.view.setBounds(bounds)
  }

  updateTheme(cssVariables: Record<string, string>): void {
    const allViews = [...this.pool, ...[...this.active.values()].map((i) => i.view)]
    for (const view of allViews) {
      view.webContents.send('overlay:theme', cssVariables)
    }
  }

  isOverlayView(sender: Electron.WebContents): boolean {
    for (const instance of this.active.values()) {
      if (instance.view.webContents === sender) return true
    }
    for (const view of this.pool) {
      if (view.webContents === sender) return true
    }
    return false
  }

  /** Handle an action from an overlay. Returns true if handled by main-process callback. */
  handleAction(sender: Electron.WebContents, actionType: string, actionData: unknown): boolean {
    for (const [, instance] of this.active) {
      if (instance.view.webContents === sender && instance.onAction) {
        instance.onAction(actionType, actionData)
        return true
      }
    }
    return false
  }

  getOverlayId(sender: Electron.WebContents): string | null {
    for (const [id, instance] of this.active) {
      if (instance.view.webContents === sender) return id
    }
    return null
  }

  destroy(): void {
    if (this.resizeHandler && this.mainWindow) {
      this.mainWindow.off('resize', this.resizeHandler)
      this.resizeHandler = null
    }

    this.hideAll()

    for (const view of this.pool) {
      view.webContents.close()
    }
    this.pool = []
    this.mainWindow = null
    log.info('Overlay manager destroyed')
  }
}

export const overlayManager = new OverlayManager()
