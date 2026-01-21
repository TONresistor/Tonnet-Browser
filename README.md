<h1 align="center">Tonnet Browser</h1>

<p align="center">
  <strong>The TON Network Browser</strong>
</p>

<p align="center">
  <a href="#about">About</a> •
  <a href="#features">Features</a> •
  <a href="#-privacy--security">Privacy & Security</a> •
  <a href="#installation">Installation</a> •
  <a href="#usage">Usage</a> •
  <a href="#settings">Settings</a> •
  <a href="#contact">Contact</a>
</p>

<p align="center">
  <a href="https://tonnet.resistance.dog"><img src="https://img.shields.io/badge/website-tonnet.resistance.dog-blue" alt="Website"></a>
  <img src="https://img.shields.io/badge/version-1.0.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20%7C%20macOS-lightgrey" alt="Platform">
</p>

<h3 align="center">Download</h3>

<p align="center">
  <a href="https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/TON.Browser.Setup.1.0.0.exe">
    <img src="https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Windows">
  </a>
  &nbsp;
  <a href="https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/TON.Browser-1.0.0-universal.dmg">
    <img src="https://img.shields.io/badge/macOS-000000?style=for-the-badge&logo=apple&logoColor=white" alt="macOS">
  </a>
  &nbsp;
  <a href="https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/TON.Browser-1.0.0.AppImage">
    <img src="https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Linux">
  </a>
</p>

<p align="center">
  <sub>
    <a href="https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/ton-browser_1.0.0_amd64.deb">Linux .deb</a> ·
    <a href="https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/TON.Browser.1.0.0.exe">Windows Portable</a> ·
    <a href="https://github.com/TONresistor/Tonnet-Browser/releases">All releases</a>
  </sub>
</p>

---

<table>
  <tr>
    <td align="center"><img src="assets/screenshot1.jpg" width="400"><br><em>Home</em></td>
    <td align="center"><img src="assets/screenshot2.jpg" width="400"><br><em>Start Page</em></td>
  </tr>
  <tr>
    <td align="center"><img src="assets/screenshot3.jpg" width="400"><br><em>Storage</em></td>
    <td align="center"><img src="assets/screenshot4.jpg" width="400"><br><em>Settings</em></td>
  </tr>
</table>

## About

Tonnet Browser is the first native cross-platform desktop browser for the TON Network with built-in anonymous garlic routing. It connects to `.ton` sites through the decentralized TON DNS and RLDP protocol - no centralized gateways, no third-party proxies.

It also includes a built-in TON Storage client for downloading and seeding bags on TON's decentralized storage network.

## Features

- Native `.ton`, `.adnl` and `.t.me` domain browsing
- Decentralized DNS resolution via TON blockchain
- Built-in TON Storage client (download, seed, pause)
- Standard browser features
- Cross-platform: Linux, Windows, macOS

## Privacy & Security

Tonnet Browser matches Tor Browser's anti-fingerprinting capabilities while offering a superior decentralized infrastructure through TON Network. Built with a privacy-first architecture, it combines proven anonymity techniques with the resilience and censorship-resistance of blockchain-based routing.

### Anonymous Browsing

**3-Hop Garlic Routing**
- Entry → Middle → Exit relays through TON nodes
- Automatic circuit rotation (configurable intervals, default: 10 minutes)
- Relay visibility in status bar
- Direct mode option for faster browsing without anonymity

### Anti-Fingerprinting Protection

**Canvas Fingerprinting**
- Deterministic noise injection to pixel readout
- Protects `getImageData()`, `toDataURL()`, `toBlob()`
- Imperceptible changes that alter fingerprint hash

**WebGL Fingerprinting**
- Spoofed vendor/renderer to generic values
- Noise injection to `readPixels()` output

**Audio Fingerprinting**
- Frequency data perturbation in AudioContext
- Subtle oscillator frequency shifts

**WebRTC IP Leak Protection**
- Blocks local IP candidates (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
- Disables mDNS candidate gathering

**Hardware Enumeration Blocking**
- Battery API disabled
- Device sensors blocked (accelerometer, gyroscope)
- Generic hardware specs: 4 cores, 8GB RAM
- Empty plugin/mimetype lists
- WebUSB, WebBluetooth, Gamepad APIs blocked

**Additional Protections**
- Screen resolution: Fixed 1920×1080 reporting
- Timezone: Forced UTC (offset 0)
- Font fingerprinting: Limited to 24 standard system fonts
- Viewport dimensions: Rounded to common multiples

### Cookie & Data Management

**First-Party Isolation**
- Per-domain sessions: Separate cookie/storage containers per site
- Format: `persist:ton-domain-{hostname}`
- Prevents cross-site tracking
- Auto-cleanup of inactive domain sessions

**Cookie Auto-Delete**
- Inactivity-based deletion (default: 30 minutes)
- Smart detection: Only deletes domains without active tabs
- Comprehensive cleanup: Cookies + localStorage + IndexedDB + Service Workers

**Clear on Exit**
- Automatic data deletion on browser close (enabled by default)
- Covers: Cache, cookies, localStorage, session data

### History Management

**Memory Mode (Default)**
- RAM-only storage, never written to disk
- Auto-cleared on exit
- Zero forensic footprint

**Persistent Mode (Encrypted)**
- OS Keychain encryption (macOS Keychain, Windows DPAPI, Linux libsecret)
- Automatic encryption, no password required
- Configurable limit: 100-10,000 entries (default: 1,000)
- Secure wrapper: SafeStorage API with atomic writes

### Network Privacy

- Generic User-Agent: Chrome 130 (no TON Browser identification)
- Referer stripping: Complete removal of navigation history leaks
- ETag removal: Request & response tracking headers stripped
- Accept-Language normalization: `en-US,en;q=0.9`
- Referrer-Policy enforcement: Forced to `no-referrer`
- Cache control: Optional `no-cache` mode

### Security Architecture

**Process Isolation**
- Main process: Privileged backend (Node.js/Electron)
- Renderer process: Sandboxed UI (no Node.js access)
- BrowserView sandbox: Isolated web content per tab
- Preload bridge: Secure IPC with context isolation

**Input Validation & Rate Limiting**
- URL validation: Protocol whitelist, path sanitization
- Navigation rate limiting: 30 requests/second
- Storage rate limiting: 10 operations/second
- Anti-ReDoS protection: Regex complexity validation
- Port validation: Range enforcement (1024-65535)

**Permission Model**
- Deny by default: All permissions (camera, microphone, geolocation)
- Content Security Policy: Enforced in production builds
- No running insecure content: WebSecurity enabled

### Transparency

- Open Source: Full codebase available for audit
- MIT License: Freedom to inspect, modify, and verify
- No telemetry or data collection
- No third-party trackers

## Installation

| Platform | Download |
|----------|----------|
| **Windows** | [Installer](https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/TON.Browser.Setup.1.0.0.exe) · [Portable](https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/TON.Browser.1.0.0.exe) |
| **macOS** | [DMG (Universal)](https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/TON.Browser-1.0.0-universal.dmg) |
| **Linux** | [AppImage](https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/TON.Browser-1.0.0.AppImage) · [.deb](https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/ton-browser_1.0.0_amd64.deb) |

### Windows

Your browser may warn that the file is from an unknown source. Click **"Keep"** to download.

1. Download and run **TON.Browser.Setup.1.0.0.exe**
2. Follow the installation prompts
3. Launch **TON Browser** from the Start menu

**One-line install:** Open PowerShell and run:

```powershell
irm https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/TON.Browser.Setup.1.0.0.exe -OutFile TonBrowser.exe; Unblock-File TonBrowser.exe; .\TonBrowser.exe
```

### macOS

Open the `.dmg` and drag TON Browser to Applications.

```bash
# If blocked by Gatekeeper
xattr -cr /Applications/TON\ Browser.app
```

**One-line install:** Open Terminal and run:

```bash
curl -LO https://github.com/TONresistor/tonnet-browser/releases/latest/download/TON.Browser-1.0.0-universal.dmg && hdiutil attach TON.Browser-1.0.0-universal.dmg && cp -R "/Volumes/TON Browser 1.0.0-universal/TON Browser.app" /Applications/ && hdiutil detach "/Volumes/TON Browser 1.0.0-universal" && xattr -cr /Applications/TON\ Browser.app && open /Applications/TON\ Browser.app
```

### Linux

```bash
# AppImage
chmod +x TON.Browser-1.0.0.AppImage
./TON.Browser-1.0.0.AppImage

# Debian/Ubuntu
sudo dpkg -i ton-browser_1.0.0_amd64.deb
```

**One-line install:** Open Terminal and run:

```bash
# AppImage
curl -LO https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/TON.Browser-1.0.0.AppImage && chmod +x TON.Browser-1.0.0.AppImage && ./TON.Browser-1.0.0.AppImage

# Debian/Ubuntu
curl -LO https://github.com/TONresistor/Tonnet-Browser/releases/latest/download/ton-browser_1.0.0_amd64.deb && sudo dpkg -i ton-browser_1.0.0_amd64.deb
```

## Usage

1. Launch TON Browser
2. Click **"Connect to TON Network"**
3. Wait for sync to complete (status bar shows "Connected to TON Network")
4. Enter a `.ton` address in the URL bar (e.g., `foundation.ton`)
5. Browse the decentralized web

### TON Storage

1. Navigate to `ton://storage` or click the Storage icon
2. Click **"Add Bag"**
3. Paste a 64-character hex bag ID
4. Monitor download progress in real-time

## Settings

Access settings via the gear icon or navigate to `ton://settings`.

| Category | Settings |
|----------|----------|
| **General** | Homepage, Restore tabs, Anonymous mode, Circuit rotation |
| **Network** | Proxy port, Storage port, Auto-connect, Connection timeout |
| **Storage** | Download path, Update interval, Auto-seed |
| **Appearance** | Zoom levels, Bookmarks bar, Status bar, Themes |
| **Privacy** | Clear browsing data, Clear on exit, Cookie settings |
| **History** | History mode, Maximum entries, View history |
| **Bookmarks** | Manage bookmarks, Folders, Import/Export |
| **Advanced** | Verbosity levels, Sync test domain |

## Building

### Prerequisites

- Node.js 18+
- npm 9+

### Development

```bash
git clone https://github.com/TONresistor/Tonnet-Browser.git
cd Tonnet-Browser
npm install
npm run dev
```

### Production Build

```bash
# Linux
npm run build:linux

# Windows
npm run build:win

# macOS
npm run build:mac
```

Builds are output to the `release/` directory.

### Tests

```bash
npm test
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| Framework | Electron 39 |
| Frontend | React 19, TypeScript |
| Styling | Tailwind CSS |
| State | Zustand |
| TON Proxy | [tonnet-proxy](https://github.com/xssnick/tonutils-proxy) |
| TON Storage | [tonutils-storage](https://github.com/xssnick/tonutils-storage) |
| Transport | RLDP over ADNL over UDP |

## Contact

- **Website**: [tonnet.resistance.dog](https://tonnet.resistance.dog)
- **Telegram**: [@zkproof](https://t.me/zkproof)
- **Issues**: [Report bugs or request features](https://github.com/TONresistor/Tonnet-Browser/issues)

## License

MIT License. See [LICENSE](LICENSE) for details.

## Acknowledgments

- [Tor Project](https://www.torproject.org/) - Inspiration for anonymous browsing
- [BitTorrent](https://www.bittorrent.org/) - Inspiration for P2P file sharing
- [tonutils-go](https://github.com/xssnick/tonutils-go) - TON protocol implementation
- [tonutils-proxy](https://github.com/xssnick/tonutils-proxy) - HTTP proxy for TON sites
- [tonutils-storage](https://github.com/xssnick/tonutils-storage) - TON Storage daemon
