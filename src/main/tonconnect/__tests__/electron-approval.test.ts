import { describe, expect, it, vi } from 'vitest'
import { ElectronTonConnectApproval } from '../electron-approval'

describe('ElectronTonConnectApproval', () => {
  it('fails closed when no application window exists', async () => {
    const overlay = { show: vi.fn(), hide: vi.fn() }
    const approval = new ElectronTonConnectApproval(overlay as never, () => null)
    await expect(approval.request({ type: 'approval' })).resolves.toBe(false)
    expect(overlay.show).not.toHaveBeenCalled()
  })

  it('maps only the approve action to consent and owns unique overlay ids', async () => {
    let callback: ((action: string) => void) | undefined
    const overlay = {
      show: vi.fn((_id, _bounds, _content, action) => {
        callback = action
      }),
      hide: vi.fn(),
    }
    const window = { getContentBounds: () => ({ width: 800, height: 600 }) }
    const approval = new ElectronTonConnectApproval(overlay as never, () => window as never)
    const result = approval.request({ type: 'approval', title: 'Connect' })
    callback?.('approve')

    await expect(result).resolves.toBe(true)
    expect(overlay.show).toHaveBeenCalledWith(
      'tonconnect-approve-1',
      { x: 0, y: 0, width: 800, height: 600 },
      { type: 'approval', title: 'Connect' },
      expect.any(Function),
      { autoDismiss: false }
    )
    expect(overlay.hide).toHaveBeenCalledWith('tonconnect-approve-1')
  })
})
