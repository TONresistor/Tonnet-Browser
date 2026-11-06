/** Static internal pages shared by the renderer registry and packaged smoke. */
export const STATIC_INTERNAL_ROUTE_PATHS = [
  'start',
  'settings',
  'theme',
  'history',
  'bookmarks',
  'wallet',
  'dns',
  'storage',
  'chat',
  'cocoon',
  'loading',
] as const
export type StaticInternalRoutePath = (typeof STATIC_INTERNAL_ROUTE_PATHS)[number]
