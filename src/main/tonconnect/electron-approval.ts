import type { BrowserWindow } from 'electron'
import type { OverlayManager } from '../windows/overlay-manager'
import { getMainWindow } from '../windows/main'
import type { TonConnectApprovalPort } from './approval'
import { KeyedRateLimiter } from '../ipc/validation'

/** Electron adapter translating a TonConnect approval request into an overlay. */
export class ElectronTonConnectApproval implements TonConnectApprovalPort {
  private counter = 0
  private unlockLimiter = new KeyedRateLimiter(5, 60_000)

  constructor(
    private readonly overlayManager: OverlayManager,
    private readonly getWindow: () => BrowserWindow | null = getMainWindow
  ) {}

  request(content: { type: string; [key: string]: unknown }, signal?: AbortSignal): Promise<boolean> {
    return this.show(content, signal)
  }

  requestUnlock(
    domain: string,
    unlock: (password: string) => Promise<boolean>,
    signal?: AbortSignal
  ): Promise<boolean> {
    return this.show(
      {
        type: 'approval',
        iconLock: true,
        title: 'Unlock wallet',
        subtitle: 'Enter your wallet password to continue',
        domain,
        passwordLabel: 'Wallet password',
        actions: [
          { id: 'deny', label: 'Cancel' },
          { id: 'approve', label: 'Unlock', primary: true },
        ],
      },
      signal,
      unlock
    )
  }

  private show(
    content: { type: string; [key: string]: unknown },
    signal?: AbortSignal,
    unlock?: (password: string) => Promise<boolean>
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const window = this.getWindow()
      if (!window || signal?.aborted) {
        resolve(false)
        return
      }
      const id = `tonconnect-approve-${++this.counter}`
      let settled = false
      let busy = false
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
      const show = (warning?: string) =>
        this.overlayManager.show(
          id,
          { x: 0, y: 0, width: bounds.width, height: bounds.height },
          warning ? { ...content, warning } : content,
          (actionType, data) => {
            if (settled) return
            if (actionType !== 'approve' || !unlock) {
              finish(actionType === 'approve')
              return
            }
            if (busy) return
            const password =
              data && typeof data === 'object' && typeof (data as { password?: unknown }).password === 'string'
                ? (data as { password: string }).password
                : ''
            if (!password || password.length > 256) {
              if (!show('Enter your wallet password.')) finish(false)
              return
            }
            if (!this.unlockLimiter.check('wallet')) {
              if (!show('Too many attempts. Wait a minute and try again.')) finish(false)
              return
            }
            busy = true
            void Promise.resolve()
              .then(() => (settled ? false : unlock(password)))
              .then((approved) => {
                busy = false
                if (settled) return
                if (approved) finish(true)
                else if (!show('Unable to unlock wallet. Check your password and try again.')) finish(false)
              })
              .catch(() => finish(false))
          },
          { autoDismiss: false, ...(unlock ? { focus: true, persistentActions: true } : {}) }
        )
      if (!show()) finish(false)
    })
  }
}
