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
      try {
        item.dispose()
      } catch (error) {
        log.error('Disposable cleanup failed:', error)
      }
    }
    this._items.clear()
  }
}

export function onWebContents<TArgs extends unknown[]>(
  wc: Electron.WebContents,
  event: string,
  handler: (...args: TArgs) => void
): IDisposable {
  const emitter = wc as unknown as EventEmitter
  // Cast required: Node EventEmitter uses any[] for variadic listener types
  emitter.on(event, handler as (...args: unknown[]) => void)
  return {
    dispose(): void {
      if (!wc.isDestroyed()) {
        emitter.removeListener(event, handler as (...args: unknown[]) => void)
      }
    },
  }
}

export function onEmitter<TArgs extends unknown[]>(
  emitter: EventEmitter,
  event: string,
  handler: (...args: TArgs) => void
): IDisposable {
  // Cast required: Node EventEmitter uses any[] for variadic listener types
  emitter.on(event, handler as (...args: unknown[]) => void)
  return {
    dispose(): void {
      emitter.removeListener(event, handler as (...args: unknown[]) => void)
    },
  }
}
