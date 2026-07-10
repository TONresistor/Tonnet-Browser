import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../shared/ipc-channels'
import { ElectronTonConnectEventDelivery } from '../electron-event-delivery'

function sender() {
  let destroyed: (() => void) | undefined
  return {
    port: {
      session: {} as never,
      once: vi.fn((_event: 'destroyed', listener: () => void) => {
        destroyed = listener
      }),
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    },
    destroy: () => destroyed?.(),
  }
}

describe('ElectronTonConnectEventDelivery', () => {
  it('delivers once per tracked sender and removes destroyed senders', () => {
    const delivery = new ElectronTonConnectEventDelivery()
    const target = sender()
    const event = { event: 'disconnect' as const, id: 7, payload: {} }

    delivery.track('app.ton', target.port)
    delivery.track('app.ton', target.port)
    delivery.emitDisconnect('app.ton', event)
    expect(target.port.send).toHaveBeenCalledOnce()
    expect(target.port.send).toHaveBeenCalledWith(IPC_CHANNELS.TONCONNECT_EVENT, event)

    target.destroy()
    delivery.emitDisconnect('app.ton', event)
    expect(target.port.send).toHaveBeenCalledOnce()
  })

  it('does not send to a destroyed WebContents', () => {
    const delivery = new ElectronTonConnectEventDelivery()
    const target = sender()
    target.port.isDestroyed.mockReturnValue(true)
    delivery.track('app.ton', target.port)
    delivery.emitDisconnect('app.ton', { event: 'disconnect', id: 1, payload: {} })
    expect(target.port.send).not.toHaveBeenCalled()
  })
})
