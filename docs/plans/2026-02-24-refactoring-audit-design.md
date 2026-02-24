# Refactoring Audit Design — Tonnet Browser v1.3.0

**Date**: 2026-02-24
**Scope**: Exhaustive code quality audit + incremental refactoring plan
**Approach**: Incremental by priority (HIGH → LOW), atomic commits, tests included

---

## Audit Summary

**Overall score: 7.9/10** — Solid foundation, targeted improvements needed.

| Category | Score | Key Issue |
|----------|-------|-----------|
| Module Boundaries | 9/10 | Excellent encapsulation |
| IPC Architecture | 8.5/10 | Strong security, good org |
| Naming Conventions | 8.5/10 | Consistent across codebase |
| Separation of Concerns | 8/10 | Minor type duplication |
| Component Design | 8/10 | Well-decomposed |
| Configuration | 8/10 | Centralized with some hardcoded values |
| Dependency Flow | 8/10 | Correct direction, minor renderer coupling |
| State Management | 7.5/10 | Cross-store coupling issues |
| Error Handling | 7.5/10 | Excellent in main, gaps in renderer |
| Testing | 6/10 | Good unit tests, no renderer tests |

### 17 Findings Identified

| # | Finding | Severity | Category |
|---|---------|----------|----------|
| 1 | Bag ID validation duplicated 6x in handlers.ts with inconsistent error messages | HIGH | DRY |
| 2 | SettingsStore is a god-store (proxy + navigation + storage in one store) | HIGH | Architecture |
| 3 | TabsStore ↔ SettingsStore direct coupling (cross-store mutations) | HIGH | Architecture |
| 4 | Zero renderer tests (40+ components, stores, hooks untested) | HIGH | Tests |
| 5 | Preload API weakly typed (`unknown` instead of concrete types) | HIGH | Types |
| 6 | No React Error Boundary — component error crashes the tree | MEDIUM | Architecture |
| 7 | Settings validation duplicated in 3 locations (main, IPC, renderer) | MEDIUM | DRY |
| 8 | 15 identical try-catch blocks in handlers.ts, `handleWithErrors` underused | MEDIUM | DRY |
| 9 | Reorder logic duplicated (bookmarks vs folders — nearly identical) | MEDIUM | DRY |
| 10 | Store subscriptions too broad — App.tsx re-renders on any change | MEDIUM | Performance |
| 11 | Lottie animations reloaded on every theme change | MEDIUM | Performance |
| 12 | LandingPage/StartPage not lazy-loaded | MEDIUM | Performance |
| 13 | settings:changed listener without cleanup (potential leak) | MEDIUM | Memory |
| 14 | EventEmitter maxListeners = 50 (workaround instead of fix) | MEDIUM | Architecture |
| 15 | No barrel exports for settings components | LOW | Organization |
| 16 | ID generation duplicated in 3 files | LOW | DRY |
| 17 | UI constants hardcoded (tab height, navbar height, cache TTL) | LOW | Config |

---

## Phase 1 — DRY & Foundations (HIGH)

### 1.1 — Extract IPC handler helpers

- Create `validateBagIdOrFail(bagId)` wrapper to eliminate 6 duplicated validations
- Centralize error messages via `IPC_ERRORS` constant object
- Use `handleWithErrors` systematically on all 15 identical try-catch blocks
- **Files**: `src/main/ipc/handlers.ts`, `src/main/ipc/error-handler.ts`

### 1.2 — Centralize settings validation

- Move all validation logic to `src/shared/validation.ts`
- Main, IPC, and renderer import from this single source
- Replace hardcoded category arrays with `keyof AppSettings`
- **Files**: `src/main/settings/validation.ts`, `src/main/ipc/validation.ts`, `src/renderer/src/stores/preferences.ts`, `src/shared/validation.ts` (new)

### 1.3 — Extract shared utilities

- ID generation → `src/shared/utils/id.ts`
- Reorder logic → `src/shared/utils/reorder.ts` (used by bookmarks and folders)
- Context menu popup → helper in `src/main/utils/menu.ts`
- **Files**: `src/renderer/src/stores/tabs.ts`, `src/renderer/src/stores/bookmarks.ts`, `src/renderer/src/lib/theme-utils.ts`

---

## Phase 2 — Store Architecture (HIGH)

### 2.1 — Split the god-store SettingsStore

Split into 3 focused stores:
- `useProxyStore` — proxy state (connected, syncing, port, anonymousMode, circuitRelays)
- `useNavigationStore` — current navigation (currentUrl, currentTitle, canGoBack, canGoForward, isLoading)
- `useStorageStatsStore` — storage statistics

The old `useSettingsStore` becomes a temporary re-export for backward compatibility.

**Files**: `src/renderer/src/stores/settings.ts` → split into 3 files

### 2.2 — Decouple TabsStore ↔ SettingsStore

- Remove direct `useSettingsStore.getState().setNavigation()` calls from TabsStore
- Pattern: TabsStore emits actions, App.tsx or a hook orchestrates cross-store sync via `useEffect` + Zustand subscriptions
- **Files**: `src/renderer/src/stores/tabs.ts`, `src/renderer/src/App.tsx`

### 2.3 — Fix listener leaks

- Wrap `window.electron.on('settings:changed')` in a singleton pattern with cleanup
- Fix `EventEmitter.defaultMaxListeners = 50` by properly cleaning up listeners per BrowserView
- **Files**: `src/renderer/src/stores/preferences.ts`, `src/main/index.ts`, `src/main/windows/tabs.ts`

---

## Phase 3 — Types & Safety (HIGH)

### 3.1 — Type the preload API

- Replace all `unknown` in `src/preload/index.d.ts` with concrete types (`StorageBag`, `BagDetails`, etc.)
- Type IPC event callbacks (typed payload per channel)
- **Files**: `src/preload/index.d.ts`, `src/shared/types.ts`

### 3.2 — Create generic IpcResult type

```typescript
type IpcResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string }
```

Replace 63 inline `{ success: boolean; error?: string }` objects in handlers.ts.

**Files**: `src/shared/types.ts`, `src/main/ipc/handlers.ts`

### 3.3 — Eliminate remaining `any`

- `secureHandle` / `secureHandleWithEvent`: type args with generics
- `useState<any>(null)` → `useState<LottieAnimationData | null>(null)`
- Replace `values as any` with proper settings type cast
- **Files**: `src/main/ipc/handlers.ts`, `src/renderer/src/App.tsx`

---

## Phase 4 — Performance & Error Handling (MEDIUM)

### 4.1 — Add React Error Boundary

- Wrap the React tree with an ErrorBoundary showing a clean fallback
- Add toast/notification system for silent IPC errors
- **Files**: `src/renderer/src/components/ui/ErrorBoundary.tsx` (new), `src/renderer/src/App.tsx`

### 4.2 — Optimize store subscriptions

- Create granular selectors for `usePreferencesStore` (one per property)
- Narrow subscriptions in App.tsx to prevent unnecessary re-renders
- **Files**: `src/renderer/src/stores/preferences.ts`, `src/renderer/src/App.tsx`

### 4.3 — Preload animations & lazy pages

- Preload both Lottie animations on initial mount (no reload on theme switch)
- Add `lazy()` on LandingPage and StartPage
- **Files**: `src/renderer/src/App.tsx`

### 4.4 — Cleanup sidebar resize timer

- Add return cleanup in useEffect for the window bounds save debounce
- **File**: `src/renderer/src/App.tsx`

---

## Phase 5 — Tests (HIGH, after refactoring)

### 5.1 — Zustand store tests

- Test refactored stores: `useProxyStore`, `useNavigationStore`, `useTabsStore`, `useBookmarksStore`, `usePreferencesStore`
- Verify mutations, selectors, and cross-store synchronization
- **Files**: `src/renderer/src/stores/__tests__/` (new directory)

### 5.2 — Custom hook tests

- Test `useProxy`, `useStorage` and any new hooks created during refactoring
- Mock `window.electron` for isolation
- **Files**: `src/renderer/src/hooks/__tests__/` (new directory)

### 5.3 — Critical component tests

- Test key components: `AddressBar`, `TabBar`, `ErrorBoundary`, `SettingsPage`
- Focus on user behavior (interactions, displayed state)
- **Files**: `src/renderer/src/components/__tests__/` (new directory)

### 5.4 — Untested main process modules

- Test `tabs.ts` (tab manager), `history/manager.ts`, `windows/main.ts`
- These critical modules currently have zero tests
- **Files**: `src/main/windows/__tests__/`, `src/main/history/__tests__/`

---

## Phase 6 — Polish & Organization (LOW)

### 6.1 — Barrel exports for settings components

- Add `index.ts` files in component directories for simpler imports
- **Directories**: `src/renderer/src/components/settings/sections/`, `src/renderer/src/components/ui/`

### 6.2 — Extract UI constants

- Move hardcoded values (tab height=44, navbar=46, bookmarks=40, cache TTL=500ms) to `src/shared/constants.ts`
- **Files**: `src/renderer/src/stores/tabs.ts`, `src/shared/constants.ts`

### 6.3 — Centralize renderer logging

- Create a renderer logger using the shared logger instead of direct `console.error`
- Replace 5+ scattered `console.error('[...]')` in stores
- **Files**: `src/renderer/src/stores/preferences.ts`, `src/renderer/src/stores/themes.ts`

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Store split causes regressions | Phase 5 tests catch issues; backward-compat re-exports |
| Type changes break preload bridge | Run `npm run type-check` after each commit |
| Handler refactoring breaks IPC | Existing handler tests validate; run tests after each change |
| Performance changes cause UI jank | Manual testing after Phase 4 |

## Success Criteria

- All 17 findings addressed
- `npm run type-check` passes with zero errors
- `npm run test` passes with zero failures
- No new `any` types introduced
- Store subscriptions narrowed (measurable fewer re-renders)
- Error Boundary catches and displays component errors gracefully
