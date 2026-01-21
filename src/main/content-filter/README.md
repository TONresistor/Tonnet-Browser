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

## Usage

```typescript
import { contentFilterManager } from './content-filter/filter-manager'

// Check if URL should be blocked
const blocked = contentFilterManager.isBlocked(
  'http://site.ton/ads/banner.jpg',
  'image'
)

// Get statistics
const stats = contentFilterManager.getStats()
console.log(`Blocked: ${stats.totalBlocked}`)
console.log(`By category:`, stats.blockedByCategory)

// Listen to block events
contentFilterManager.on('blocked', (event) => {
  console.log(`Blocked ${event.category}: ${event.url}`)
})

// Enable/disable
contentFilterManager.setEnabled(false) // Disable filtering
contentFilterManager.setEnabled(true)  // Re-enable
```

## Integration

The filter is integrated into `browser-view.ts` via `session.webRequest.onBeforeRequest`:

```typescript
ses.webRequest.onBeforeRequest({ urls: ['http://*/*'] }, (details, callback) => {
  if (contentFilterManager.isBlocked(details.url, details.resourceType)) {
    callback({ cancel: true }) // Block request
    return
  }
  callback({}) // Allow request
})
```

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
