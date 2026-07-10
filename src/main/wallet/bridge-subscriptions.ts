import { SubscriptionResultSchema } from './bridge-codecs'
import { BridgeEventBus, type BridgeEventCallback } from './bridge-event-bus'

type RpcParams = Record<string, unknown>
type Request = (method: string, params: RpcParams) => Promise<unknown>

interface Registration {
  method: string
  params: RpcParams
  event: string
  callback: BridgeEventCallback
  active: boolean
  subscriptionId: string | null
  activation: Promise<void> | null
}

/** Owns subscription registration, disposal and reconnect resubscription. */
export class BridgeSubscriptions {
  private readonly registrations = new Set<Registration>()
  private readonly byId = new Map<string, Registration>()
  private readonly events: BridgeEventBus
  private resubscribeFlight: Promise<void> | null = null

  constructor(
    private readonly request: Request,
    onError: (operation: string, error: unknown) => void
  ) {
    this.events = new BridgeEventBus((event, error) => onError(`event:${event}`, error))
    this.onError = onError
  }

  private readonly onError: (operation: string, error: unknown) => void

  subscribe(method: string, params: RpcParams, event: string, callback: BridgeEventCallback): () => void {
    const registration: Registration = {
      method,
      params,
      event,
      callback,
      active: true,
      subscriptionId: null,
      activation: null,
    }
    this.registrations.add(registration)
    this.events.on(event, callback)
    void this.activate(registration)
    return () => this.dispose(registration)
  }

  on(event: string, callback: BridgeEventCallback): () => void {
    return this.events.on(event, callback)
  }

  off(event: string, callback: BridgeEventCallback): void {
    this.events.off(event, callback)
  }

  emit(event: string, data: unknown): void {
    this.events.emit(event, data)
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    const registration = this.byId.get(subscriptionId)
    if (registration) {
      this.dispose(registration)
      return
    }
    await this.remoteUnsubscribe(subscriptionId)
  }

  async resubscribeAll(): Promise<void> {
    if (this.resubscribeFlight) return this.resubscribeFlight
    this.resubscribeFlight = (async () => {
      const active = [...this.registrations].filter((registration) => registration.active)
      this.byId.clear()
      for (const registration of active) {
        registration.subscriptionId = null
        registration.activation = null
      }
      await Promise.all(active.map((registration) => this.activate(registration)))
    })().finally(() => {
      this.resubscribeFlight = null
    })
    return this.resubscribeFlight
  }

  clear(): void {
    for (const registration of this.registrations) {
      registration.active = false
      this.events.off(registration.event, registration.callback)
    }
    this.registrations.clear()
    this.byId.clear()
    this.events.clear()
    this.resubscribeFlight = null
  }

  private activate(registration: Registration): Promise<void> {
    if (!registration.active) return Promise.resolve()
    if (registration.activation) return registration.activation
    registration.activation = this.request(registration.method, registration.params)
      .then(async (raw) => {
        const { subscription_id: subscriptionId } = SubscriptionResultSchema.parse(raw)
        if (!registration.active) {
          await this.remoteUnsubscribe(subscriptionId)
          return
        }
        registration.subscriptionId = subscriptionId
        this.byId.set(subscriptionId, registration)
      })
      .catch((error) => this.onError(`subscribe:${registration.method}`, error))
      .finally(() => {
        registration.activation = null
      })
    return registration.activation
  }

  private dispose(registration: Registration): void {
    if (!registration.active) return
    registration.active = false
    this.registrations.delete(registration)
    this.events.off(registration.event, registration.callback)
    const subscriptionId = registration.subscriptionId
    registration.subscriptionId = null
    if (subscriptionId) {
      this.byId.delete(subscriptionId)
      void this.remoteUnsubscribe(subscriptionId)
    }
  }

  private async remoteUnsubscribe(subscriptionId: string): Promise<void> {
    try {
      await this.request('subscribe.unsubscribe', { subscription_id: subscriptionId })
    } catch (error) {
      this.onError('unsubscribe', error)
    }
  }
}
