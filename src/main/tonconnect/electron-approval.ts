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

  request(content: { type: string; [key: string]: unknown }, signal?: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      const window = this.getWindow()
      if (!window || signal?.aborted) {
        resolve(false)
        return
      }
      const id = `tonconnect-approve-${++this.counter}`
      let settled = false
      const finish = (approved: boolean) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', abort)
        this.overlayManager.hide(id)
        resolve(approved)
      }
      const abort = () => finish(false)
      signal?.addEventListener('abort', abort, { once: true })
      const bounds = window.getContentBounds()
      const shown = this.overlayManager.show(
        id,
        { x: 0, y: 0, width: bounds.width, height: bounds.height },
        content,
        (actionType) => finish(actionType === 'approve'),
        { autoDismiss: false }
      )
      if (!shown) finish(false)
    })
  }
}
