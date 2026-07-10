import type { BrowserWindow } from 'electron'
import type { OverlayManager } from '../windows/overlay-manager'
import { getMainWindow } from '../windows/main'
import type { TonConnectApprovalPort } from './approval'

/** Electron adapter translating a TonConnect approval request into an overlay. */
export class ElectronTonConnectApproval implements TonConnectApprovalPort {
  private counter = 0

  constructor(
    private readonly overlayManager: OverlayManager,
    private readonly getWindow: () => BrowserWindow | null = getMainWindow
  ) {}

  request(content: { type: string; [key: string]: unknown }): Promise<boolean> {
    return new Promise((resolve) => {
      const window = this.getWindow()
      if (!window) {
        resolve(false)
        return
      }
      const id = `tonconnect-approve-${++this.counter}`
      const bounds = window.getContentBounds()
      this.overlayManager.show(
        id,
        { x: 0, y: 0, width: bounds.width, height: bounds.height },
        content,
        (actionType) => {
          this.overlayManager.hide(id)
          resolve(actionType === 'approve')
        },
        { autoDismiss: false }
      )
    })
  }
}
