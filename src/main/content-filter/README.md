# Content Filtering

Blocks ads, trackers, cryptominers, and malicious content on .ton sites.

## Features

- **14 filter patterns** covering common threats
- **Pattern-based blocking** using RegEx matching
- **Resource type filtering** (script, image, xhr, etc.)
- **Real-time statistics** tracking
- **Event emitter** for UI integration
- **Zero dependencies** (uses only Node.js built-ins)

## Architecture

```
HTTP Request → onBeforeRequest → ContentFilterManager.isBlocked()
                                          ↓
                                    [Whitelist check]
                                          ↓
                                 [First-party check] ──→ skip ads/trackers/annoyances
                                          ↓
                                    [Check patterns]
                                          ↓
                                    Block or Allow
```

## Filter Categories

### 1. Advertisements
- `/ads/`, `/advert/`, `/banner/`, `/popup/`, `/sponsor/`
- `_ad_`, `.ad.`, `-ad-` in filenames
- `/promo/` promotional content

### 2. Trackers & Analytics
- `/track/`, `/analytics/`, `/beacon/`, `/telemetry/`
- Tracking pixels: `pixel.gif`, `pixel.png`
- Tracking parameters: `?utm_`, `?ga_`, `?fbclid`
- Fingerprinting: `/fingerprint/`, `/device-id/`

### 3. Cryptominers
- Known services: `coinhive`, `crypto-loot`, `jsecoin`
- Generic patterns: `/miner/`, `/mining/`, `/webminer/`
- Web workers: `/worker.mine.js`

### 4. Malware
- Malicious keywords: `malware`, `virus`, `trojan`, `keylog`
- Executable downloads: `.exe`, `.dll`, `.bat`, `.vbs`, `.ps1`

### 5. Annoyances
- Intrusive overlays: `/modal/`, `/overlay/`, `/interstitial/`
- Push notifications: `/notification/`, `/push-notify/`

## First-party requests

The patterns above are generic path heuristics written for third-party URLs, so they
also fire on a site's own routes: `/api/analytics/...`, `/api/stats/...` and
`/api/v1/track/...` are ordinary API paths, and cancelling them leaves a page loading
its shell and then sitting empty with no visible error.

So `isBlocked` takes the host of the top-level document, and skips the
**third-party-only** categories — `ads`, `trackers`, `annoyances` — when the request
is same-site.

- **Miners and malware stay enforced first-party.** A compromised tonsite serving a
  miner from its own origin is exactly the case worth blocking.
- Subdomains count as same-site in both directions (`api.site.ton` ↔ `site.ton`), but
  shared registry suffixes (`ton`, `t.me`, … — taken from `SUPPORTED_TLDS`) are
  excluded from the parent match, or every tonsite would be first-party to every other.
- Omitting the argument, or passing `null`, blocks exactly as before.

## Usage

```typescript
// Obtained from the ServiceRegistry (see services.ts), not a module singleton.
const { contentFilterManager } = registry

// Sync configuration from user settings (enabled state, whitelist, category toggles)
contentFilterManager.applySettings(getSetting('contentFiltering'))

// Third argument is the top-level document's host; without it every rule applies.
const blocked = contentFilterManager.isBlocked('http://site.ton/ads/banner.jpg', 'image', 'site.ton')
```

## Integration

The filter is integrated into `browser-view.ts` via `session.webRequest.onBeforeRequest`:

```typescript
ses.webRequest.onBeforeRequest((details, callback) => {
  if (contentFilterManager.isBlocked(details.url, details.resourceType, resolveFirstPartyHost(details, sessionHost))) {
    callback({ cancel: true }) // Block request
    return
  }
  callback({}) // Allow request
})
```

`resolveFirstPartyHost` reads `details.frame?.top?.url`, falling back to the isolated
session's own domain when the frame is already gone (destroyed, or cross-process
teardown). Sessions are created per domain in `tabs-session.ts`, which is where that
fallback host comes from; bag sessions pass `null`, having no domain of their own.

## Testing

Run tests:
```bash
npm test -- filter-manager.test.ts
```

**Test coverage:** 29 tests covering all filter categories

## Performance

- **Pattern matching:** <1ms per URL check
- **Memory usage:** ~1KB for filter rules
- **No network calls:** 100% local filtering

## Future Enhancements

1. **User settings** - Enable/disable categories
2. **Whitelist** - Per-domain bypass
3. **Custom patterns** - User-defined rules
4. **Malicious site database** - SQLite blocklist
5. **Warning pages** - Block with explanation

## TON-Specific Design

Unlike traditional ad blockers (EasyList, uBlock Origin), this filter is designed specifically for TON sites:

- No HTTPS certificate checks
- No third-party domain blocking (all sites are .ton)
- Pattern-based (not domain-based)
- Lightweight (14 patterns vs 60,000+ in EasyList)
- Zero external dependencies

## License

MIT
