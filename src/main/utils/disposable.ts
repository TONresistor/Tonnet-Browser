/**
 * Lightweight disposal pattern for deterministic cleanup of listeners and resources.
 */

import { EventEmitter } from 'events'
import { createLogger } from '../../shared/logger'

const log = createLogger('disposable')

export interface IDisposable {
  dispose(): void
}

export class DisposableStore implements IDisposable {
  private _items = new Set<IDisposable>()
  private _isDisposed = false

  get isDisposed(): boolean {
    return this._isDisposed
  }

  add<T extends IDisposable>(item: T): T {
    if (this._isDisposed) {
      log.warn('Adding to an already-disposed store; disposing item immediately')
      item.dispose()
      return item
    }
    this._items.add(item)
    return item
  }

  dispose(): void {
    if (this._isDisposed) return
    this._isDisposed = true
    for (const item of this._items) {
      item.dispose()
    }
    this._items.clear()
  }
}

export function onWebContents(wc: Electron.WebContents, event: string, handler: (...args: any[]) => void): IDisposable {
  wc.on(event as any, handler)
  return {
    dispose(): void {
      if (!wc.isDestroyed()) {
        wc.removeListener(event as any, handler)
      }
    },
  }
}

export function onEmitter(emitter: EventEmitter, event: string, handler: (...args: any[]) => void): IDisposable {
  emitter.on(event, handler)
  return {
    dispose(): void {
      emitter.removeListener(event, handler)
    },
  }
}
