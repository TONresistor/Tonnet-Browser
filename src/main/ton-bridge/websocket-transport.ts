import WebSocket from 'ws'

export type WebSocketTransportState = 'disconnected' | 'connecting' | 'connected' | 'stopped'

export interface WebSocketTransportHooks {
  onMessage(message: string): void
  onSocketOpen(): Promise<void>
  onReady(reconnected: boolean): void
  onDisconnect(error: Error): void
  onError(error: Error): void
  onReconnectScheduled(delayMs: number, attempt: number): void
}

export interface WebSocketTransportOptions {
  heartbeatIntervalMs: number
  pongTimeoutMs: number
  reconnectBaseMs: number
  reconnectMaxMs: number
}

type SocketFactory = (url: string) => WebSocket

const DEFAULT_OPTIONS: WebSocketTransportOptions = {
  heartbeatIntervalMs: 54_000,
  pongTimeoutMs: 6_000,
  reconnectBaseMs: 1_000,
  reconnectMaxMs: 30_000,
}

/** Owns WebSocket connection, heartbeat, reconnect and timer/listener cleanup. */
export class WebSocketTransport {
  private socket: WebSocket | null = null
  private state: WebSocketTransportState = 'disconnected'
  private connectFlight: Promise<void> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private pongTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private hasConnected = false
  private pendingReject: ((error: Error) => void) | null = null

  constructor(
    private readonly url: string,
    private readonly hooks: WebSocketTransportHooks,
    private readonly options: WebSocketTransportOptions = DEFAULT_OPTIONS,
    private readonly createSocket: SocketFactory = (target) => new WebSocket(target)
  ) {}

  connect(): Promise<void> {
    if (this.state === 'connected') return Promise.resolve()
    if (this.connectFlight) return this.connectFlight
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.state = 'connecting'
    this.connectFlight = this.establish(false).finally(() => {
      this.connectFlight = null
    })
    return this.connectFlight
  }

  stop(): void {
    this.state = 'stopped'
    this.clearTimers()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    const rejectPending = this.pendingReject
    this.pendingReject = null
    rejectPending?.(new Error('Transport stopped'))
    const socket = this.socket
    this.socket = null
    if (socket) {
      socket.removeAllListeners()
      socket.close()
    }
  }

  isConnected(): boolean {
    return this.state === 'connected'
  }

  currentState(): WebSocketTransportState {
    return this.state
  }

  send(message: string): Promise<void> {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('WebSocket not open'))
    return new Promise((resolve, reject) => {
      socket.send(message, (error) =>
        error ? reject(new Error(`WebSocket send failed: ${error.message}`)) : resolve()
      )
    })
  }

  private establish(reconnected: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pendingReject = reject
      const socket = this.createSocket(this.url)
      this.socket = socket
      const onOpen = async () => {
        cleanupInitial()
        if (this.state === 'stopped') {
          socket.close()
          reject(new Error('Transport stopped'))
          return
        }
        this.socket = socket
        this.setupRuntimeListeners(socket)
        this.startHeartbeat()
        try {
          await this.hooks.onSocketOpen()
          if (this.isStopped() || this.socket !== socket || socket.readyState !== WebSocket.OPEN) {
            reject(new Error('Connection closed during readiness'))
            return
          }
          this.state = 'connected'
          this.reconnectAttempt = 0
          const connectionIsReconnect = reconnected || this.hasConnected
          this.hasConnected = true
          this.hooks.onReady(connectionIsReconnect)
          this.pendingReject = null
          resolve()
        } catch (error) {
          const failure = error instanceof Error ? error : new Error(String(error))
          this.pendingReject = null
          socket.terminate()
          reject(failure)
        }
      }
      const onError = (error: Error) => {
        cleanupInitial()
        if (this.socket === socket) this.socket = null
        this.pendingReject = null
        this.state = 'disconnected'
        this.hooks.onError(error)
        reject(error)
      }
      const onClose = () => {
        cleanupInitial()
        if (this.socket === socket) this.socket = null
        this.pendingReject = null
        this.state = 'disconnected'
        reject(new Error('Connection closed before open'))
      }
      const cleanupInitial = () => {
        socket.removeListener('open', onOpen)
        socket.removeListener('error', onError)
        socket.removeListener('close', onClose)
      }
      socket.once('open', onOpen)
      socket.once('error', onError)
      socket.once('close', onClose)
    })
  }

  private setupRuntimeListeners(socket: WebSocket): void {
    socket.on('message', (data) => this.hooks.onMessage(data.toString()))
    socket.on('pong', () => this.onPong())
    socket.on('close', (code, reason) => this.handleClose(socket, code, reason.toString()))
    socket.on('error', (error) => this.hooks.onError(error))
  }

  private handleClose(socket: WebSocket, code: number, reason: string): void {
    if (this.socket !== socket) return
    this.socket = null
    socket.removeAllListeners()
    this.clearTimers()
    if (this.state === 'stopped') return
    this.state = 'disconnected'
    this.hooks.onDisconnect(new Error(`Connection lost (${code}${reason ? `: ${reason}` : ''})`))
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.state === 'stopped' || this.reconnectTimer) return
    const delay = Math.min(
      this.options.reconnectBaseMs * Math.pow(2, this.reconnectAttempt),
      this.options.reconnectMaxMs
    )
    const attempt = ++this.reconnectAttempt
    this.hooks.onReconnectScheduled(delay, attempt)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.state === 'stopped') return
      this.state = 'connecting'
      const flight = this.establish(true)
      this.connectFlight = flight
      void flight
        .catch(() => this.scheduleReconnect())
        .finally(() => {
          if (this.connectFlight === flight) this.connectFlight = null
        })
    }, delay)
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const socket = this.socket
      if (!socket || socket.readyState !== WebSocket.OPEN) return
      socket.ping()
      if (this.pongTimer) clearTimeout(this.pongTimer)
      this.pongTimer = setTimeout(() => socket.terminate(), this.options.pongTimeoutMs)
    }, this.options.heartbeatIntervalMs)
  }

  private onPong(): void {
    if (!this.pongTimer) return
    clearTimeout(this.pongTimer)
    this.pongTimer = null
  }

  private clearTimers(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.pongTimer) clearTimeout(this.pongTimer)
    this.heartbeatTimer = null
    this.pongTimer = null
  }

  private isStopped(): boolean {
    return this.state === 'stopped'
  }
}
