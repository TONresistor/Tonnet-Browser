export type ChatSessionState =
  | { kind: 'idle' }
  | { kind: 'resolving'; room: string }
  | { kind: 'joining'; room: string }
  | { kind: 'connected'; room: string }
  | { kind: 'leaving'; room: string }
  | { kind: 'failed'; room: string; error: string }

export interface ManagedChatSession {
  room: string
  dispose(): Promise<void>
}

export interface ChatRuntimeSession extends ManagedChatSession {
  overlayId: string
  via: 'node' | 'dht'
  bootstrap?: string
  peerId: string
  clockOffsetSec: number
  bindingChallenge: string
  gated: boolean
  ownerKey?: Buffer
  cert: Buffer | null
}

export interface ChatConnectContext {
  markJoining(): void
}

/** Serializes Messenger lifecycle commands and owns exactly one live session. */
export class ChatSessionController<TSession extends ManagedChatSession> {
  private current: TSession | null = null
  private stateValue: ChatSessionState = { kind: 'idle' }
  private commandTail: Promise<unknown> = Promise.resolve()

  get state(): ChatSessionState {
    return this.stateValue
  }

  get session(): TSession | null {
    return this.current
  }

  connect(room: string, establish: (context: ChatConnectContext) => Promise<TSession>): Promise<TSession> {
    return this.enqueue(async () => {
      await this.leaveCurrent()
      this.stateValue = { kind: 'resolving', room }
      try {
        const session = await establish({
          markJoining: () => {
            if (this.stateValue.kind === 'resolving' && this.stateValue.room === room) {
              this.stateValue = { kind: 'joining', room }
            }
          },
        })
        this.current = session
        this.stateValue = { kind: 'connected', room: session.room }
        return session
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.stateValue = { kind: 'failed', room, error: message }
        throw error
      }
    })
  }

  disconnect(): Promise<void> {
    return this.enqueue(async () => {
      await this.leaveCurrent()
      this.stateValue = { kind: 'idle' }
    })
  }

  runWhenIdle<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    return this.enqueue(async () => {
      if (this.current || !['idle', 'failed'].includes(this.stateValue.kind)) {
        throw new Error('Disconnect Messenger before restarting the Bridge')
      }
      return operation()
    })
  }

  runDisconnected<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    return this.enqueue(async () => {
      await this.leaveCurrent()
      this.stateValue = { kind: 'idle' }
      return operation()
    })
  }

  private async leaveCurrent(): Promise<void> {
    const session = this.current
    if (!session) return
    this.current = null
    this.stateValue = { kind: 'leaving', room: session.room }
    await session.dispose()
  }

  private enqueue<TResult>(command: () => Promise<TResult>): Promise<TResult> {
    const result = this.commandTail.catch(() => undefined).then(command)
    this.commandTail = result
    return result
  }
}
