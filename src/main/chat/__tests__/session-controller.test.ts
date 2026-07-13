import { describe, expect, it, vi } from 'vitest'
import { ChatSessionController, type ManagedChatSession } from '../session-controller'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

function session(room: string, dispose: () => Promise<void> = vi.fn(async () => {})): ManagedChatSession {
  return { room, dispose }
}

describe('ChatSessionController', () => {
  it('exposes explicit resolving, joining and connected states', async () => {
    const controller = new ChatSessionController<ManagedChatSession>()
    const joining = deferred<ManagedChatSession>()
    const connecting = controller.connect('room', async ({ markJoining }) => {
      expect(controller.state).toEqual({ kind: 'resolving', room: 'room' })
      markJoining()
      return joining.promise
    })

    await vi.waitFor(() => expect(controller.state).toEqual({ kind: 'joining', room: 'room' }))
    joining.resolve(session('room'))
    await connecting
    expect(controller.state).toEqual({ kind: 'connected', room: 'room' })
  })

  it('serializes overlapping connects and disposes the previous session first', async () => {
    const events: string[] = []
    const controller = new ChatSessionController<ManagedChatSession>()
    await controller.connect('first', async () =>
      session('first', async () => {
        events.push('leave:first')
      })
    )

    const second = controller.connect('second', async () => {
      events.push('join:second')
      return session('second')
    })
    const third = controller.connect('third', async () => {
      events.push('join:third')
      return session('third')
    })
    await Promise.all([second, third])

    expect(events).toEqual(['leave:first', 'join:second', 'join:third'])
    expect(controller.session?.room).toBe('third')
  })

  it('serializes disconnect behind an in-flight connect', async () => {
    const controller = new ChatSessionController<ManagedChatSession>()
    const pending = deferred<ManagedChatSession>()
    const connect = controller.connect('room', () => pending.promise)
    const disconnect = controller.disconnect()
    pending.resolve(session('room'))

    await connect
    await disconnect
    expect(controller.session).toBeNull()
    expect(controller.state).toEqual({ kind: 'idle' })
  })

  it('records failure and allows a later command to recover', async () => {
    const controller = new ChatSessionController<ManagedChatSession>()
    await expect(controller.connect('bad', async () => Promise.reject(new Error('offline')))).rejects.toThrow('offline')
    expect(controller.state).toEqual({ kind: 'failed', room: 'bad', error: 'offline' })

    await controller.connect('good', async () => session('good'))
    expect(controller.state).toEqual({ kind: 'connected', room: 'good' })
  })

  it('holds later connects until an idle-only operation completes', async () => {
    const events: string[] = []
    const controller = new ChatSessionController<ManagedChatSession>()
    const gate = deferred<void>()
    const guarded = controller.runWhenIdle(async () => {
      events.push('guard:start')
      await gate.promise
      events.push('guard:end')
    })
    const connect = controller.connect('room', async () => {
      events.push('connect')
      return session('room')
    })

    await vi.waitFor(() => expect(events).toEqual(['guard:start']))
    gate.resolve()
    await Promise.all([guarded, connect])

    expect(events).toEqual(['guard:start', 'guard:end', 'connect'])
  })

  it('disconnects the current session before a guarded restart', async () => {
    const events: string[] = []
    const controller = new ChatSessionController<ManagedChatSession>()
    await controller.connect('room', async () =>
      session('room', async () => {
        events.push('dispose')
      })
    )

    await controller.runDisconnected(async () => {
      events.push('restart')
    })

    expect(events).toEqual(['dispose', 'restart'])
    expect(controller.state).toEqual({ kind: 'idle' })
  })
})
