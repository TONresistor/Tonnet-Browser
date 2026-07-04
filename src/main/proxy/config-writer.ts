/**
 * Proxy/bridge config.json generation. Extracted from ProxyManager (OPP-36).
 *
 * Concentrates three invariants in one place:
 *  - tunnel activation via TunnelSectionsNum (proxy config)
 *  - re-enforcement of REQUIRED_NAMESPACES on every bridge start (bridge config)
 *  - durable, secret-safe writes via writeSecureJsonAtomic (0o600)
 */
import path from 'path'
import fs from 'fs'
import { randomBytes } from 'crypto'
import { cpus } from 'os'
import { writeSecureJsonAtomic } from '../utils/secure-fs'
import { createLogger } from '../../shared/logger'
import { DEFAULT_NAMESPACE_STATE, REQUIRED_NAMESPACES } from '../../shared/bridge-config'

const log = createLogger('proxy')

/**
 * Apply browser namespace defaults to the bridge config.json.
 * Runs once per install: disables unused namespaces (least privilege),
 * preserves user overrides on subsequent launches via _browserDefaults flag.
 * Required namespaces are always re-enforced regardless.
 */
export function applyBridgeDefaults(workDir: string): void {
  const configPath = path.join(workDir, 'config.json')
  if (!fs.existsSync(configPath)) return

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    if (config._browserDefaults) {
      // Already applied, only enforce required namespaces
      let changed = false
      const ns = config.namespaces as Record<string, Record<string, unknown>> | undefined
      if (ns) {
        for (const required of REQUIRED_NAMESPACES) {
          if (ns[required] && ns[required].enabled === false) {
            ns[required].enabled = true
            changed = true
          }
        }
        // Experimental group chat (ton://chat) needs these on existing installs too.
        for (const chatNs of ['adnl', 'overlay', 'dht']) {
          if (ns[chatNs] && ns[chatNs].enabled === false) {
            ns[chatNs].enabled = true
            changed = true
          }
        }
      }
      if (changed) {
        writeSecureJsonAtomic(configPath, config)
        log.info('Re-enforced required bridge namespaces')
      }
      return
    }

    // First application: set namespace defaults
    const ns = config.namespaces as Record<string, Record<string, unknown>> | undefined
    if (ns) {
      for (const [name, enabled] of Object.entries(DEFAULT_NAMESPACE_STATE)) {
        if (!ns[name]) ns[name] = {}
        ns[name].enabled = enabled
      }
    }
    config._browserDefaults = true
    writeSecureJsonAtomic(configPath, config)

    const disabled = Object.entries(DEFAULT_NAMESPACE_STATE)
      .filter(([, v]) => !v)
      .map(([k]) => k)
    log.info(`Bridge namespace defaults applied, disabled: ${disabled.join(', ')}`)
  } catch (err) {
    log.warn('Failed to apply bridge defaults:', err)
  }
}

export function writeProxyConfig(workDir: string, tunnelSections: number): void {
  const configPath = path.join(workDir, 'config.json')

  if (fs.existsSync(configPath)) {
    // Patch existing config
    try {
      const existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      if (existing.TunnelConfig) {
        existing.TunnelConfig.NodesPoolConfigPath = ''
        existing.TunnelConfig.TunnelSectionsNum = tunnelSections
      }
      existing.BlockHTTP = true // always block cleartext HTTP
      writeSecureJsonAtomic(configPath, existing, 2)
      log.info(`Proxy config updated: tunnelSections=${tunnelSections}`)
      return
    } catch {
      // Corrupted config -- regenerate below
    }
  }

  // First run: generate config with correct tunnel settings immediately
  // This avoids the double-start (direct -> restart -> tunnel)
  const generateKey = () => Array.from(randomBytes(32))
  const config = {
    Version: 1,
    ADNLKey: generateKey(),
    BlockHTTP: true,
    CustomTunnelNetworkConfigPath: '',
    TunnelConfig: {
      TunnelServerKey: generateKey(),
      TunnelThreads: cpus().length,
      TunnelSectionsNum: tunnelSections,
      NodesPoolConfigPath: '',
      PaymentsEnabled: false,
      Payments: {
        ADNLServerKey: generateKey(),
        PaymentsNodeKey: generateKey(),
        WalletPrivateKey: generateKey(),
        DBPath: './payments-db/',
        SecureProofPolicy: false,
        ChannelsConfig: {
          SupportedCoins: { Ton: { Enabled: true }, Jettons: {}, ExtraCurrencies: {} },
          BufferTimeToCommit: 10800,
          QuarantineDurationSec: 21600,
          ConditionalCloseDurationSec: 10800,
          MinSafeVirtualChannelTimeoutSec: 300,
        },
      },
    },
  }
  writeSecureJsonAtomic(configPath, config, 2)
  log.info(`Proxy config generated: tunnelSections=${tunnelSections}`)
}
