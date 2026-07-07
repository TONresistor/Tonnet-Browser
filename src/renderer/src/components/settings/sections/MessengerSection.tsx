import { memo, useCallback, useEffect, useState } from 'react'
import { Copy, Check, ChevronLeft, ChevronRight, LoaderCircle, RadioTower } from 'lucide-react'
import { Toggle } from '../shared/Toggle'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/logger'
import { useConfirmAction } from '@/hooks/useConfirmAction'
import type { OwnChatIdentity, MessengerSettings } from '@shared/types'
import { avatarColor, initial } from '@/components/pages/chat/util'
import deviceTileSrc from '@/assets/messenger-device.svg'
import walletTileSrc from '@/assets/wallet.svg'
import tonTileSrc from '@/assets/ton.png'
import resetTileSrc from '@/assets/messenger-reset.svg'
import vkdogSrc from '@/assets/vkdog.png'
import anonAvatarSrc from '@/assets/anon-avatar.svg'
import '../settings.css'

const TILE_GLYPH = 'h-[17px] w-[17px] object-contain'
const TILE_WHITE = { filter: 'brightness(0) invert(1)' }

const log = createLogger('messenger-settings')

interface MessengerSectionProps {
  onIdentityChange?: (id: OwnChatIdentity | null) => void
}

export const MessengerSection = memo(function MessengerSection({ onIdentityChange }: MessengerSectionProps) {
  const [identity, setIdentity] = useState<OwnChatIdentity | null>(null)
  const [attach, setAttach] = useState(false)
  const [networkEnabled, setNetworkEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [linking, setLinking] = useState(false)
  const [networking, setNetworking] = useState(false)
  const [domains, setDomains] = useState<string[]>([])
  const [detected, setDetected] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [domainError, setDomainError] = useState<string | null>(null)
  const [tonView, setTonView] = useState(false)
  const resetConfirm = useConfirmAction()

  const applyIdentity = useCallback(
    (id: OwnChatIdentity | null) => {
      setIdentity(id)
      onIdentityChange?.(id)
    },
    [onIdentityChange]
  )

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const [id, prefs] = await Promise.all([
          window.electron.chat.identity(),
          window.electron.settings.get('messenger'),
        ])
        if (!active) return
        setIdentity(id)
        setAttach(Boolean((prefs as MessengerSettings)?.attachWalletIdentity))
        setNetworkEnabled(Boolean((prefs as MessengerSettings)?.networkEnabled))
      } catch (err) {
        log.error('Failed to load messenger settings:', err)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [])

  const copyDeviceKey = useCallback(() => {
    if (!identity) return
    navigator.clipboard
      .writeText(identity.deviceKey)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }, [identity])

  const toggleAttach = useCallback(
    async (v: boolean) => {
      setAttach(v)
      setLinking(true)
      try {
        await window.electron.settings.set('messenger', { attachWalletIdentity: v })
        applyIdentity(v ? await window.electron.chat.linkIdentity() : await window.electron.chat.identity())
      } catch (err) {
        log.error('Failed to update wallet link:', err)
      } finally {
        setLinking(false)
      }
    },
    [applyIdentity]
  )

  const toggleNetwork = useCallback(
    async (v: boolean) => {
      const previous = networkEnabled
      setNetworkEnabled(v)
      setNetworking(true)
      try {
        const res = await window.electron.settings.set('messenger', { networkEnabled: v })
        if (!res.success) throw new Error(res.error ?? 'Failed to update messenger networking')
      } catch (err) {
        setNetworkEnabled(previous)
        log.error('Failed to update messenger networking:', err)
      } finally {
        setNetworking(false)
      }
    },
    [networkEnabled]
  )

  const detect = useCallback(async () => {
    setDetecting(true)
    setDomainError(null)
    try {
      const res = await window.electron.chat.detectDomains()
      setDomains(res.domains)
      setDetected(true)
    } catch (err) {
      log.error('Failed to detect domains:', err)
    } finally {
      setDetecting(false)
    }
  }, [])

  const claim = useCallback(
    async (domain: string) => {
      setDomainError(null)
      try {
        const res = await window.electron.chat.claimDomain(domain)
        applyIdentity(res.identity)
        if (res.ok) {
          setDomains([])
          setDetected(false)
        } else {
          setDomainError(res.reason ?? 'Could not verify domain ownership')
        }
      } catch (err) {
        log.error('Failed to claim domain:', err)
      }
    },
    [applyIdentity]
  )

  const removeDomain = useCallback(async () => {
    try {
      applyIdentity(await window.electron.chat.clearDomain())
    } catch (err) {
      log.error('Failed to clear domain:', err)
    }
  }, [applyIdentity])

  const handleReset = useCallback(async () => {
    if (!resetConfirm.trigger()) return
    try {
      await window.electron.settings.set('messenger', { attachWalletIdentity: false })
      const id = await window.electron.chat.resetIdentity()
      setAttach(false)
      applyIdentity(id)
      setDomains([])
      setDetected(false)
      setDomainError(null)
    } catch (err) {
      log.error('Failed to reset chat identity:', err)
    }
  }, [resetConfirm, applyIdentity])

  useEffect(() => {
    if (!attach || !identity?.linked || detected) return
    void detect()
  }, [attach, identity?.linked, detected, detect])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoaderCircle className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    )
  }

  const walletReady = Boolean(identity?.walletReady)
  const linked = Boolean(attach && identity?.linked)
  const displayName = linked
    ? (identity?.domain ?? identity?.addressShort ?? '...')
    : identity
      ? `#${identity.deviceKey.slice(0, 10)}`
      : '...'
  const avatarSeed = identity?.domain ?? (linked ? identity?.addressShort : identity?.deviceKey) ?? '?'
  const walletSub = !walletReady
    ? 'No wallet'
    : linked && identity?.addressShort
      ? identity.addressShort
      : attach
        ? 'Linking...'
        : 'Anonymous'
  const tonSub = identity?.domain ? identity.domain : linked ? 'Not set' : 'Needs a linked wallet'
  const domainOptions = identity?.domain && !domains.includes(identity.domain) ? [...domains, identity.domain] : domains

  if (tonView) {
    return (
      <div className="msg-view-enter px-1">
        <div className="flex items-center gap-1.5 py-2">
          <button
            type="button"
            onClick={() => setTonView(false)}
            aria-label="Back"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <span className="text-[15px] font-medium text-foreground">Link a .ton</span>
        </div>

        <div className="settings-group overflow-hidden">
          <button
            type="button"
            onClick={() => {
              void removeDomain()
              setTonView(false)
            }}
            className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-hover"
          >
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full"
              style={{ backgroundColor: '#0098EA' }}
            >
              <img src={walletTileSrc} alt="" className="h-[18px] w-[18px] object-contain" style={TILE_WHITE} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium text-foreground">Wallet address</div>
              <div className="truncate font-mono text-[11px] text-muted-foreground">{identity?.addressShort ?? ''}</div>
            </div>
            {!identity?.domain && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
          </button>

          {domainOptions.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                void claim(d)
                setTonView(false)
              }}
              className="flex w-full items-center gap-3 border-t border-border-subtle px-3 py-2.5 text-left transition-colors hover:bg-surface-hover"
            >
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[14px] font-semibold text-white"
                style={{ backgroundColor: avatarColor(d) }}
              >
                {initial(d)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[14px] lowercase text-foreground">{d}</span>
              {identity?.domain === d && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
            </button>
          ))}
        </div>

        {detecting && (
          <div className="flex items-center gap-2 px-3 py-3 text-[12px] text-muted-foreground">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Scanning your wallet...
          </div>
        )}
        {!detecting && domainOptions.length === 0 && (
          <p className="px-3 py-3 text-[12px] text-muted-foreground">No .ton names in this wallet.</p>
        )}
        {domainError && <p className="px-3 pt-1 text-[11px] text-destructive">{domainError}</p>}
      </div>
    )
  }

  return (
    <div className="px-1">
      <div className="flex flex-col items-center gap-2.5 py-3">
        {linked ? (
          <img src={vkdogSrc} alt="" className="h-16 w-16 rounded-full object-cover" />
        ) : (
          <span
            className="grid h-16 w-16 place-items-center rounded-full"
            style={{ backgroundColor: avatarColor(avatarSeed) }}
          >
            <img src={anonAvatarSrc} alt="" className="h-9 w-9 object-contain" style={TILE_WHITE} />
          </span>
        )}
        <div
          className={`max-w-full truncate text-[15px] font-medium text-foreground ${identity?.domain ? 'lowercase' : 'font-mono'}`}
        >
          {displayName}
        </div>
      </div>

      <div className="settings-group">
        <div className="flex items-center gap-3 rounded-t-[13px] px-3 py-2.5">
          <span
            className="grid h-[29px] w-[29px] shrink-0 place-items-center rounded-[8px]"
            style={{ backgroundColor: '#8E8E93' }}
          >
            <img src={deviceTileSrc} alt="" className={TILE_GLYPH} style={TILE_WHITE} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium text-foreground">Device key</div>
            <div className="truncate font-mono text-[11px] text-muted-foreground">
              {identity ? `#${identity.deviceKey.slice(0, 16)}` : '...'}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground"
            onClick={copyDeviceKey}
            disabled={!identity}
            aria-label="Copy device key"
          >
            {copied ? (
              <Check className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Copy className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        </div>

        <div className="flex items-center gap-3 border-t border-border-subtle px-3 py-2.5">
          <span
            className="grid h-[29px] w-[29px] shrink-0 place-items-center rounded-[8px]"
            style={{ backgroundColor: '#34C759' }}
          >
            <RadioTower className="h-[17px] w-[17px] text-white" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium text-foreground">Messenger network</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {networkEnabled ? 'ADNL, Overlay, DHT enabled' : 'Off until enabled'}
            </div>
          </div>
          <Toggle
            checked={networkEnabled}
            onChange={toggleNetwork}
            ariaLabel="Messenger network"
            disabled={networking}
          />
        </div>

        <div className="flex items-center gap-3 border-t border-border-subtle px-3 py-2.5">
          <span
            className="grid h-[29px] w-[29px] shrink-0 place-items-center rounded-[8px]"
            style={{ backgroundColor: '#0098EA' }}
          >
            <img src={walletTileSrc} alt="" className={TILE_GLYPH} style={TILE_WHITE} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium text-foreground">Link wallet</div>
            <div className="truncate text-[11px] text-muted-foreground">{walletSub}</div>
          </div>
          <Toggle checked={attach} onChange={toggleAttach} ariaLabel="Link wallet" disabled={!walletReady || linking} />
        </div>

        <button
          type="button"
          onClick={() => setTonView(true)}
          disabled={!linked}
          className="flex w-full items-center gap-3 border-t border-border-subtle px-3 py-2.5 text-left transition-colors enabled:hover:bg-surface-hover disabled:opacity-60"
        >
          <span
            className="grid h-[29px] w-[29px] shrink-0 place-items-center rounded-[8px]"
            style={{ backgroundColor: '#0098EA' }}
          >
            <img src={tonTileSrc} alt="" className={TILE_GLYPH} style={TILE_WHITE} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium text-foreground">Link a .ton</div>
            <div className="truncate text-[11px] text-muted-foreground">{tonSub}</div>
          </div>
          {linked && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
        </button>

        <div className="flex items-center gap-3 rounded-b-[13px] border-t border-border-subtle px-3 py-2.5">
          <span
            className="grid h-[29px] w-[29px] shrink-0 place-items-center rounded-[8px]"
            style={{ backgroundColor: '#FF3B30' }}
          >
            <img src={resetTileSrc} alt="" className={TILE_GLYPH} style={TILE_WHITE} />
          </span>
          <span className="flex-1 text-[14px] font-medium text-foreground">Reset identity</span>
          <Button variant="destructive" size="sm" onClick={handleReset}>
            {resetConfirm.isArmed() ? 'Confirm' : 'Reset'}
          </Button>
        </div>
      </div>
    </div>
  )
})
