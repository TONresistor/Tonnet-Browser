// Experimental Tonnet group chat — browser client.
//
// Framework-agnostic. Talks to the browser's already-bundled tonutils-bridge over
// its local WebSocket JSON-RPC, using ONLY methods that already exist in the bridge
// (dns.resolve, adnl.connectByADNL, overlay.join/leave/sendMessage, overlay.message
// events, adnl.disconnect). No bridge change is required for this MVP.
//
// Wiring: adapt your existing bridge WS client to the `BridgeRPC` interface below
// (see ./README.md) and pass it in.

/** groupchat.ton — its DNS *site* record points at the anchor's ADNL id. */
export const GROUPCHAT_DOMAIN = 'groupchat.ton'

/** Room descriptor. overlay id = tl.Hash(pub.overlay{ name: GROUPCHAT_ROOM }). */
export const GROUPCHAT_ROOM = 'tonnet:groupchat:v1'

/** base64 overlay id, printed by the anchor on startup — must match the anchor. */
export const GROUPCHAT_OVERLAY_ID_B64 = 'YNsvFzQZ4AKXJmBLLHrm4p2JmoATens+MJCXxCb8gZM='

export interface BridgeRPC {
  /** Call a bridge JSON-RPC method and resolve with its `result` object. */
  call(method: string, params: unknown): Promise<any>
  /** Subscribe to a bridge push event; returns an unsubscribe function. */
  onEvent(name: string, cb: (params: any) => void): () => void
}

export interface ChatMessage {
  nick: string
  text: string
  ts: number
  /** true for the local optimistic echo of a message this client just sent. */
  self?: boolean
}

const utf8ToB64 = (s: string): string => btoa(unescape(encodeURIComponent(s)))
const b64ToUtf8 = (b: string): string => decodeURIComponent(escape(atob(b)))

function hexToB64(hex: string): string {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin)
}

/**
 * Minimal chat session over the room overlay via the local bridge.
 *
 * Flow: resolve groupchat.ton -> anchor ADNL -> connect -> join overlay -> the
 * anchor relays messages between all connected clients. The sender does not get an
 * echo back from the anchor, so `send()` emits an optimistic local copy.
 */
export class GroupchatClient {
  private peerId?: string
  private unsub?: () => void
  private keepalive?: ReturnType<typeof setInterval>

  constructor(
    private rpc: BridgeRPC,
    private nick: string,
    private onMessage: (m: ChatMessage) => void,
  ) {}

  async connect(): Promise<void> {
    // 1. groupchat.ton -> anchor ADNL id (site record, returned as hex)
    const dom = await this.rpc.call('dns.resolve', { domain: GROUPCHAT_DOMAIN })
    const siteHex: string | undefined = dom?.site_adnl
    if (!siteHex) throw new Error('groupchat.ton has no ADNL site record yet')

    // 2. connect to the anchor over ADNL (input adnl_id is base64)
    const conn = await this.rpc.call('adnl.connectByADNL', { adnl_id: hexToB64(siteHex) })
    this.peerId = conn.peer_id

    // 3. join the room overlay through that peer connection
    await this.rpc.call('overlay.join', {
      overlay_id: GROUPCHAT_OVERLAY_ID_B64,
      peer_id: this.peerId,
    })

    // 4. receive: overlay.message events carry the relayed chat payloads
    this.unsub = this.rpc.onEvent('overlay.message', (p) => {
      if (p?.overlay_id !== GROUPCHAT_OVERLAY_ID_B64) return
      try {
        const m = JSON.parse(b64ToUtf8(p.message)) as ChatMessage & { type?: string }
        // Control frames (hello/presence/…) keep us in the anchor's relay set
        // but are not chat lines — skip anything that isn't a plain message.
        if (m.type && m.type !== 'msg') return
        this.onMessage({ nick: String(m.nick ?? '?'), text: String(m.text ?? ''), ts: Number(m.ts ?? Date.now()), self: false })
      } catch {
        /* ignore non-chat payloads on this overlay */
      }
    })

    // 5. announce ourselves: the anchor only relays to peers that have spoken the
    // overlay, so send a hello immediately to register as a member (and receive
    // others' messages) before typing. Best effort — a real send also registers us.
    this.rpc
      .call('overlay.sendMessage', {
        overlay_id: GROUPCHAT_OVERLAY_ID_B64,
        data: utf8ToB64(JSON.stringify({ type: 'hello', ts: Date.now() })),
      })
      .catch(() => {})

    // 6. keepalive: ping the anchor so the NAT mapping stays open — otherwise an
    // idle client behind NAT stops receiving relayed messages (mapping expires).
    this.keepalive = setInterval(() => {
      if (this.peerId) this.rpc.call('adnl.ping', { peer_id: this.peerId }).catch(() => {})
    }, 10_000)
  }

  async send(text: string): Promise<void> {
    const msg: ChatMessage & { type: string } = { type: 'msg', nick: this.nick, text, ts: Date.now() }
    await this.rpc.call('overlay.sendMessage', {
      overlay_id: GROUPCHAT_OVERLAY_ID_B64,
      data: utf8ToB64(JSON.stringify(msg)),
    })
    this.onMessage({ ...msg, self: true }) // optimistic local echo
  }

  async disconnect(): Promise<void> {
    if (this.keepalive) clearInterval(this.keepalive)
    this.keepalive = undefined
    this.unsub?.()
    this.unsub = undefined
    try {
      await this.rpc.call('overlay.leave', { overlay_id: GROUPCHAT_OVERLAY_ID_B64 })
    } catch {
      /* best effort */
    }
    if (this.peerId) {
      try {
        await this.rpc.call('adnl.disconnect', { peer_id: this.peerId })
      } catch {
        /* best effort */
      }
      this.peerId = undefined
    }
  }
}
