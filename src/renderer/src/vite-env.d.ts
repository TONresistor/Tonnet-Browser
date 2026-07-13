/**
 * Minimal ImportMeta.hot typing for Vite HMR cleanup.
 *
 * We intentionally do NOT `/// <reference types="vite/client" />` here: vite/client
 * redeclares the same asset modules (*.png, *.svg, *.gif, *.jpg) already declared in
 * assets.d.ts, which would collide. This narrow augmentation gives type-safe access to
 * `import.meta.hot` and removes the unsafe double-cast in the renderer stores.
 */
interface ViteHotContext {
  readonly data: unknown
  accept(cb?: (mod: unknown) => void): void
  dispose(cb: (data: unknown) => void): void
}

interface ImportMeta {
  readonly hot?: ViteHotContext
  glob<T>(patterns: string[]): Record<string, () => Promise<T>>
}
