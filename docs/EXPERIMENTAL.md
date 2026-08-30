# Experimental features

These features are disabled by default and exposed under **Settings > Advanced > Experimental**

| Feature           | Setting                          | Purpose                                               | Main dependency                   |
| ----------------- | -------------------------------- | ----------------------------------------------------- | --------------------------------- |
| Messenger         | `messenger.networkEnabled`       | DHT room discovery and ADNL overlay messaging         | Tonutils Bridge + Messenger node  |
| Unicode domains   | `advanced.displayUnicodeDomains` | Display decoded internationalized TON domains         | `punycode`                        |
| TON Connect       | `advanced.tonConnectEnabled`     | Advertise the embedded wallet to compatible TON Sites | Embedded wallet                   |
| HTTP 402 payments | `wallet.paymentMode`             | Approve or automate payment requests from TON Sites   | Embedded wallet + Tonutils Bridge |

Defaults live in `src/shared/defaults.ts`. The controls live in `AdvancedSection.tsx`; feature-specific settings stay in their owning module.
