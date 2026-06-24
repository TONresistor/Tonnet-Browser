# Changelog

All notable changes to Tonnet Browser are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- TON Connect support for tonsites.
- In-app file browser for storage bags with a bag sidebar.
- DNS page resolves full records with an open-site shortcut.
- Tab title and favicon for internal pages.

### Changed
- Redesigned settings, wallet, storage, cocoon, bookmarks, history and DNS pages.
- Cocoon chat renders markdown; setup wizard redesigned with a reset option.
- Coin amounts shown as GRAM.
- More reliable wallet transaction history.

### Fixed
- Orphaned native daemons no longer block startup.
- Wallet key storage writes are atomic and durable.

### Security
- File browser escapes bag file names; update check drops the identifying User-Agent; sign-data prompt shows payload details.

## [2.1.0] - 2026-06-20

### Added
- Storage page: peers column with per-row hover actions.

### Changed
- Bundled proxy updated to v1.10.0: ENSIP-7 contenthash resolution for `.eth` (ADNL multicodec `0xb69910`) with legacy `adnl` text-record fallback; tonutils-go v1.17.2 (fixes 32-bit Android build).
- Bundled bridge updated to v0.3.0: tonutils-go v1.17.2 (fixes 32-bit Android build).
- Bundled storage updated to v1.5.1: faster downloads and speed calc, parallel filesystem reads, and optimized DHT bag-overlay store/refresh; tonutils-go v1.17.1.
- Bundled cocoon runtime (gocoon/cocoon-runner) updated to v0.2.1: transport keepalive ping, OpenAI tools translation; tonutils-go v1.17.2 (fixes 32-bit Android build).
- BookmarksBar context menu and Wallet strings fully localized across all 10 locales.
- Storage page: completed bag status uses primary color.
- Dependencies bumped: Electron 41.3.0, Tailwind 4.2.4, i18next 26.0.8, react-i18next 17.0.4, @ton/ton 16.3.0, happy-dom 20.9.0, globals 17.5.0.
- CI runs on `dev` branch pushes and PRs; Dependabot capped at 5 npm PRs.

### Security
- Resolved all high/moderate `npm audit` advisories: axios 1.15.0 → 1.18.0 (via @ton/ton 16.3.0), plus ws 8.21.0, tmp 0.2.7, form-data 4.0.6, vite 7.3.5 and other transitive build-tooling bumps.

## [2.0.0] - 2026-04-25

### Added
- `.eth` and `.sol` resolver toggles with optional custom RPC URLs.

### Changed
- History writes use atomic secure-fs helpers.
- CI workflow actions pinned to commit SHAs.

### Fixed
- Clear browsing data covers all isolated domain sessions.
- Settings reset reapplies runtime state for every service.
- Address bar focus outline covers the full bubble.
- Uniform background on storage-bag loading page.
- Tabs defer view attach until first paint to show loading on Linux.

### Security
- `shell.openExternal` allowlisted to `github.com` and `resistance.dog`.
- Encrypted wallet key file written with `0o600`.
- `app-settings.json` written with `0o600` to protect user-supplied RPC URLs.
- 402 payment retry aborts on cross-origin redirect.
- 402 requests with `maxTimeoutSeconds` below 5 seconds rejected.

## [1.6.2] - 2026-04-21

### Added
- HTTP 402 payments on `fetch` and `XHR` requests.
- Payment approval popup and address bar pill notification styles.

### Changed
- Bundled proxy updated to v1.9.5 (multi-chain resolver).
- Zustand store selectors refactored, dead IPC channels and build scripts removed.

### Fixed
- x402 payments on fresh (undeployed) W5 wallets.
- Wallet seqno synchronizes to on-chain value after a failed broadcast.
- Address bar menu strings localized across all 8 locales.

### Security
- Hardened 402 flow: XHR request deduplication, token reference counting, request body cloning, popup rate limiting.

## [1.6.1] - 2026-04-15

### Changed
- Bundled proxy updated to v1.9.4 with multi-chain resolver support.

## [1.6.0] - 2026-04-13

### Added
- Embedded wallet: auto-lock with configurable timeout, import, delete, and mnemonic backup.
- Bridge permission system for `tonsite://` dApps, with per-domain and per-scope decisions.
- Native ADNL tunnel for multi-hop anonymous routing.
- DHT discovery of tunnel relay nodes at startup.
- Local WebSocket bridge replacing centralized TON APIs.
- File browser for TON Storage bags.
- Overlay system (glass blur `WebContentsView` pool) for menus, permissions, and forms.
- Manual update checker (`node:https` fetch of `tonnet.resistance.dog/updates.json`, opens the download page via `shell.openExternal`).
- Configurable tunnel mode for anonymous routing.
- Seeding toggle and bandwidth limits for TON Storage.
- Redesigned error page with Lottie animation.
- Winget manifest and auto-publish workflow.
- Wallet resolves `.ton` domains and subdomains for transfers.

### Changed
- Dependency injection architecture via `ServiceRegistry`.
- Bundled proxy v1.9.3, bridge v0.2.0, storage v1.4.1, compiled from source in CI.
- `userData` path migrated to a canonical directory.
- `electron-updater` replaced by the manual `node:https` checker.
- Overlay assets packaged in the ASAR archive and loaded via the `app://` custom protocol.
- Atomic file writes for settings and sensitive data via `writeJsonAtomic` helpers.
- Electron-log output redirected to the canonical `userData` path.
- Legacy network settings fields migrated to `tunnelMode`.
- Upstream Go binaries pinned to tested versions.
- React upgraded to 19.2.5, `lucide-react` upgraded to 1.7.0.

### Fixed
- Payment flow TOCTOU via reserve/confirm/rollback pattern.
- Startup sequence, bridge deferred start, parallel storage init, process cleanup.
- Screen dimensions letterboxed dynamically to prevent fingerprinting drift.
- Raw seed file backed up before encrypted migration.
- Wallet send validates recipient address and checks balance.
- Storage download path clickable (#48).
- Invalid `BridgeTransaction.now` fallback removed.

### Security
- Hardened anti-fingerprinting, WebSocket blocking, bridge isolation.
- SSRF bypass closed, storage authentication enforced, CSP scoped to web responses, session cleanup.
- Config file permissions tightened, payment flush on exit.
- `happy-dom` bumped to fix CVE-2026-33943.
- `vite` and `yaml` bumped to resolve audit vulnerabilities.
- Symlink resolution before `bagfile://` path validation.

## [1.5.3] - 2026-03-25

### Fixed
- NSIS `.exe_` renaming on Windows installer.

## [1.5.2] - 2026-03-25

### Fixed
- Proxy startup parsing updated for v0.6.0 output format.

## [1.5.1] - 2026-03-25

### Fixed
- Updater double-registration on macOS.
- Binary download failure on Windows.

## [1.5.0] - 2026-03-24

### Added
- Embedded TON wallet.
- DNS resolution for `.ton` domains.
- UI improvements across browser chrome.

### Changed
- Release artifact filenames stabilized (version-less) for predictable download URLs.

### Security
- `flatted` bumped to resolve a prototype pollution vulnerability.

## [1.4.2] - 2026-03-16

### Added
- CI pipeline hardened with coverage thresholds and dependency review.
- React Compiler enabled, dynamic Lottie imports, prefetch of lazy pages on proxy connect.
- Renderer test suite.

### Changed
- Upgraded to Electron 41, Node 22, ESLint 9, Tailwind 4.
- `BrowserView` migrated to `WebContentsView`.
- Anti-fingerprinting script extracted, IPC handlers split.
- User-Agent aligned with Chrome/146.

### Fixed
- Static imports restored for `StartPage` and `LandingPage` to eliminate `ton://start` delay and black screen on first load.
- `history-reset` bug.
- Hardcoded UI strings translated across 6 components.
- Native `confirm()` replaced in `HistoryPage`, `ErrorBoundary` localized.
- `BookmarksBar` modal localized.

### Security
- WebRTC STUN IP leak closed.
- DNS leak, device permissions, `navigator.connection` exposure hardened.
- 8 findings from deep security scan resolved.
- `flatted` and `tar` high-severity vulnerabilities patched.

## [1.4.1] - 2026-03-01

### Fixed
- Custom `app://` protocol replaces `file://` in packaged builds.

## [1.4.0] - 2026-03-01

### Added
- Manual update checker.
- CI pipeline for push/PR validation and cross-platform builds.

### Changed
- Audit findings applied: DRY, type safety, renderer performance.
- Download links redirected to `tonnet.resistance.dog/download`.

### Fixed
- Auto-connect loading animation and proxy status restored.

## [1.3.0] - 2026-02-09

### Added
- Vertical tab mode with resizable sidebar and configurable orientation.
- Adaptive sidebar tabs with optimized resize handling.

### Changed
- Type safety strengthened across the preload boundary.
- Context menu, content filter, IPC channels, and bookmarks deduplicated.
- React re-renders, window bounds debouncing, `TabBar` optimized.

### Fixed
- `HistoryPage` and `StoragePage` localized, `StatusBar` locale restored, modal focus trap repaired.
- Invalid JSON repaired in 9 locale files.
- Window controls positioned at top-right in vertical tab mode.

### Security
- Input validation hardened for proxy, history, and bookmarks.
- `shell.openExternal` validated, error page XSS closed, `permissionCheckHandler` added.

## [1.1.0] - 2026-01-23

### Added
- Multilingual support (English, Russian) with modular locale files.
- Content filtering with settings UI (ads, trackers, miners, malware).
- Drag and drop for tabs and bookmarks.
- Bookmark folders with context menu, bookmark favicons, tab favicons.
- Encrypted browsing history with autocomplete.
- Privacy settings panel with toggles for protection features.
- First-Party Isolation, Cookie Auto-Delete, Letterboxing.
- Anti-fingerprinting, font fingerprinting protection, cache control, window security hardening.

### Changed
- Settings modularized, main-process logging centralized.
- Renderer performance and error handling optimized.

### Fixed
- `BrowserView` memory leak (listener accumulation via `setBrowserView`).
- `EventEmitter` max listeners raised to 50.
- Letterboxing visual artifacts and viewport resizing.
- Page load failure handling.

## [1.0.1] - 2026-01-09

### Fixed
- DevTools, cache headers, and URL scheme handling.
- Download links aligned with v1.0.0 filenames.
- macOS volume name in installer one-liner.

### Security
- Proxy binds `127.0.0.1` instead of `0.0.0.0`.

## [1.0.0] - 2025-12-31

### Added
- Initial public release.
- Anonymous mode with ADNL circuit rotation and garlic routing.
- Theming system (Resistance Dog, Utya Duck).
- `.t.me` domain badge support.
- Liquid glass UI with interactive garlic routing visualization.
- Default bookmarks set.
- Platform binaries for Linux, macOS, Windows.

### Fixed
- macOS crashes and copy/paste support.
- Preload script path for ES module builds.
- Utya Duck theme persistence and colors.

[Unreleased]: https://github.com/TONresistor/Tonnet-Browser-stable/compare/v1.6.2...HEAD
[1.6.2]: https://github.com/TONresistor/Tonnet-Browser-stable/compare/v1.6.1...v1.6.2
[1.6.1]: https://github.com/TONresistor/Tonnet-Browser-stable/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/TONresistor/Tonnet-Browser-stable/compare/v1.5.3...v1.6.0
[1.5.3]: https://github.com/TONresistor/Tonnet-Browser-stable/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/TONresistor/Tonnet-Browser-stable/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/TONresistor/Tonnet-Browser-stable/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/TONresistor/Tonnet-Browser-stable/compare/v1.4.2...v1.5.0
[1.4.2]: https://github.com/TONresistor/Tonnet-Browser-stable/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/TONresistor/Tonnet-Browser-stable/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/TONresistor/Tonnet-Browser-stable/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/TONresistor/Tonnet-Browser-stable/compare/v1.1.0...v1.3.0
[1.1.0]: https://github.com/TONresistor/Tonnet-Browser-stable/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/TONresistor/Tonnet-Browser-stable/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/TONresistor/Tonnet-Browser-stable/releases/tag/v1.0.0
