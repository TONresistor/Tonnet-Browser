import { DisposableStore } from '../utils/disposable'

export interface RegisteredView<TView> {
  view: TView
  disposables: DisposableStore
}

/** Owns tab views and their listener scopes without depending on Electron. */
export class ViewRegistry<TView> {
  private readonly entriesById = new Map<string, RegisteredView<TView>>()
  private activeId: string | null = null

  get size(): number {
    return this.entriesById.size
  }

  get activeViewId(): string | null {
    return this.activeId
  }

  has(tabId: string): boolean {
    return this.entriesById.has(tabId)
  }

  get(tabId: string): TView | null {
    return this.entriesById.get(tabId)?.view ?? null
  }

  getActive(): TView | null {
    return this.activeId ? this.get(this.activeId) : null
  }

  add(tabId: string, view: TView, disposables: DisposableStore): void {
    if (this.entriesById.has(tabId)) throw new Error(`View already registered for tab ${tabId}`)
    this.entriesById.set(tabId, { view, disposables })
  }

  replace(tabId: string, view: TView, disposables: DisposableStore): TView | null {
    const previous = this.remove(tabId, { preserveActiveId: true })
    this.entriesById.set(tabId, { view, disposables })
    return previous
  }

  activate(tabId: string): boolean {
    if (!this.entriesById.has(tabId)) return false
    this.activeId = tabId
    return true
  }

  deactivate(tabId?: string): void {
    if (tabId === undefined || this.activeId === tabId) this.activeId = null
  }

  remove(tabId: string, options: { preserveActiveId?: boolean } = {}): TView | null {
    const entry = this.entriesById.get(tabId)
    if (!entry) return null
    entry.disposables.dispose()
    this.entriesById.delete(tabId)
    if (!options.preserveActiveId && this.activeId === tabId) this.activeId = null
    return entry.view
  }

  entries(): IterableIterator<[string, RegisteredView<TView>]> {
    return this.entriesById.entries()
  }

  clear(): RegisteredView<TView>[] {
    const entries = [...this.entriesById.values()]
    for (const entry of entries) entry.disposables.dispose()
    this.entriesById.clear()
    this.activeId = null
    return entries
  }
}
