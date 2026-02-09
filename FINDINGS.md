# Tonnet Browser - Audit Findings Tracker

## Stats
- Total findings: 71
- Planned fixes: 43
- Fixed: 0/43
- Deferred: 20 (risky/out of scope)
- False positives: 5
- By design: 3

## Findings Table

| # | ID | Category | Severity | Finding | Status | Wave |
|---|-----|----------|----------|---------|--------|------|
| 1 | SEC-C1 | Security | CRITICAL | shell.openExternal() no scheme validation | OPEN | 1 |
| 2 | SEC-H1 | Security | HIGH | XSS in error page via inline onclick | OPEN | 1 |
| 3 | SEC-H2 | Security | HIGH | sandbox:true would break preload | DEFERRED | - |
| 4 | SEC-H3 | Security | HIGH | CSP dev mode acceptable | DEFERRED | - |
| 5 | SEC-H4 | Security | HIGH | (false positive) | N/A | - |
| 6 | SEC-M1 | Security | MEDIUM | Missing setPermissionCheckHandler | OPEN | 1 |
| 7 | SEC-M2 | Security | MEDIUM | Dead code else branch in preload | OPEN | 1 |
| 8 | SEC-M3 | Security | MEDIUM | syncTestDomain no regex validation | OPEN | 2 |
| 9 | SEC-M4 | Security | MEDIUM | deleteByPattern ReDoS timeout | OPEN | 2 |
| 10 | SEC-M5 | Security | MEDIUM | rotateInterval no format validation | OPEN | 2 |
| 11 | SEC-M6 | Security | MEDIUM | Notification UI for fallback = feature | DEFERRED | - |
| 12 | SEC-M7 | Security | MEDIUM | (false positive) | N/A | - |
| 13 | SEC-L1 | Security | LOW | Versions in about page = refactor UX | DEFERRED | - |
| 14 | SEC-L2 | Security | LOW | (false positive) | N/A | - |
| 15 | SEC-L3 | Security | LOW | ASAR integrity = config build | DEFERRED | - |
| 16 | SEC-L4 | Security | LOW | Missing contentFiltering category | OPEN | 1 |
| 17 | SEC-L5 | Security | LOW | HTTP localhost acceptable | DEFERRED | - |
| 18 | SEC-L6 | Security | LOW | Preload BrowserView = major refactor | DEFERRED | - |
| 19 | SEC-L7 | Security | LOW | Bookmark menu no URL validation | OPEN | 2 |
| 20 | SEC-L8 | Security | LOW | Window bounds no type validation | OPEN | 1 |
| 21 | SEC-L9 | Security | LOW | (false positive) | N/A | - |
| 22 | ARCH-H1 | Architecture | HIGH | any types in preferences/handlers | OPEN | 6 |
| 23 | ARCH-H2 | Architecture | HIGH | Missing AppSettings export for preload | OPEN | 6 |
| 24 | ARCH-H3 | Architecture | HIGH | Duplicated context menu code | OPEN | 5 |
| 25 | ARCH-H4 | Architecture | HIGH | (false positive) | N/A | - |
| 26 | ARCH-M1 | Architecture | MEDIUM | Settings mapping = structural refactor | DEFERRED | - |
| 27 | ARCH-M2 | Architecture | MEDIUM | Dual source of truth = structural refactor | DEFERRED | - |
| 28 | ARCH-M3 | Architecture | MEDIUM | Unhandled saveToSettings promises | OPEN | 5 |
| 29 | ARCH-M4 | Architecture | MEDIUM | getFolderDepth no max-depth guard | OPEN | 2 |
| 30 | ARCH-M5 | Architecture | MEDIUM | App.tsx size = cosmetic | DEFERRED | - |
| 31 | ARCH-M6 | Architecture | MEDIUM | Toast system = feature | DEFERRED | - |
| 32 | ARCH-M7 | Architecture | MEDIUM | ErrorBoundary recovery = feature | DEFERRED | - |
| 33 | ARCH-M8 | Architecture | MEDIUM | Duplicate validChannels arrays | OPEN | 5 |
| 34 | ARCH-M9 | Architecture | MEDIUM | Duplicate default bookmarks | OPEN | 5 |
| 35 | ARCH-M10 | Architecture | MEDIUM | Duplicated content filter settings sync | OPEN | 5 |
| 36 | ARCH-M11 | Architecture | MEDIUM | IPC patterns = medium risk refactor | DEFERRED | - |
| 37 | ARCH-M12 | Architecture | MEDIUM | (by design) | N/A | - |
| 38 | ARCH-M13 | Architecture | MEDIUM | onBlur setTimeout = fragile but functional | DEFERRED | - |
| 39 | ARCH-M14 | Architecture | MEDIUM | Missing historyMode in PrivacySettings | OPEN | 5 |
| 40 | ARCH-M15 | Architecture | MEDIUM | webContents.destroy = Electron API | DEFERRED | - |
| 41 | ARCH-M16 | Architecture | MEDIUM | Anti-fingerprinting extraction = major refactor | DEFERRED | - |
| 42 | ARCH-M17 | Architecture | MEDIUM | Missing IPC channels in shared/types | OPEN | 5 |
| 43 | PERF-H1 | Performance | HIGH | No React.lazy for pages | OPEN | 4 |
| 44 | PERF-H2 | Performance | HIGH | npm audit fix needed | OPEN | 3 |
| 45 | PERF-M1 | Performance | MEDIUM | AddressBar not memoized | OPEN | 4 |
| 46 | PERF-M2 | Performance | MEDIUM | usePreferences returns full object | OPEN | 3 |
| 47 | PERF-M3 | Performance | MEDIUM | useTabs activeTab computed every render | OPEN | 4 |
| 48 | PERF-M4 | Performance | MEDIUM | TabBar inline lambdas | OPEN | 3 |
| 49 | PERF-M5 | Performance | MEDIUM | Static Lottie imports both animations | OPEN | 4 |
| 50 | PERF-M6 | Performance | MEDIUM | Anti-fingerprint perf = low impact | DEFERRED | - |
| 51 | PERF-M7 | Performance | MEDIUM | No debounce on saveWindowBounds | OPEN | 3 |
| 52 | PERF-M8 | Performance | MEDIUM | Vite config needs benchmarking | DEFERRED | - |
| 53 | PERF-L1 | Performance | LOW | writeFile sync in saveWindowBounds | OPEN | 3 |
| 54 | PERF-L2 | Performance | LOW | 1100ms delay = intentional UX | DEFERRED | - |
| 55 | PERF-L3 | Performance | LOW | Source maps = tsconfig not vite build | DEFERRED | - |
| 56 | PERF-L4 | Performance | LOW | TabBar announcements not memoized | OPEN | 3 |
| 57 | PERF-L5 | Performance | LOW | destroyAllTabs iterates Map while modifying | OPEN | 3 |
| 58 | UX-C1 | UX | CRITICAL | (by design) | N/A | - |
| 59 | UX-C2 | UX | CRITICAL | (by design) | N/A | - |
| 60 | UX-C3 | UX | CRITICAL | (addressed in other findings) | N/A | - |
| 61 | UX-C4 | UX | CRITICAL | i18n missing in HistoryPage/StoragePage | OPEN | 7 |
| 62 | UX-H1 | UX | HIGH | (addressed in other findings) | N/A | - |
| 63 | UX-H2 | UX | HIGH | (addressed in other findings) | N/A | - |
| 64 | UX-H3 | UX | HIGH | (addressed in other findings) | N/A | - |
| 65 | UX-H4 | UX | HIGH | (addressed in other findings) | N/A | - |
| 66 | UX-H5 | UX | HIGH | (addressed in other findings) | N/A | - |
| 67 | UX-H6 | UX | HIGH | (addressed in other findings) | N/A | - |
| 68 | UX-H7 | UX | HIGH | (addressed in other findings) | N/A | - |
| 69 | UX-H8 | UX | HIGH | Modal focus trap missing | OPEN | 7 |
| 70 | UX-H9 | UX | HIGH | StatusBar hardcodes fr-FR locale | OPEN | 7 |
| 71 | UX-H10 | UX | HIGH | BookmarksBar hidden without proxy (by design) | N/A | - |
