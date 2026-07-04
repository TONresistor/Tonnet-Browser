export const GROUPCHAT_DOMAIN = 'groupchat.ton'

export const GROUPCHAT_ROOM = 'tonnet:groupchat:v1'

export const GROUPCHAT_OVERLAY_ID_B64 = 'YNsvFzQZ4AKXJmBLLHrm4p2JmoATens+MJCXxCb8gZM='

export interface BridgeRPC {
  call(method: string, params: unknown): Promise<any>
  onEvent(name: string, cb: (params: any) => void): () => void
}

export interface ChatMessage {
  nick: string
  text: string
  ts: number
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

export class GroupchatClient {
  private peerId?: string
  private unsub?: () => void
  private keepalive?: ReturnType<typeof setInterval>

  constructor(
    private rpc: BridgeRPC,
    private nick: string,
    private onMessage: (m: ChatMessage) => void
  ) {}

  async connect(): Promise<void> {
    const dom = await this.rpc.call('dns.resolve', { domain: GROUPCHAT_DOMAIN })
    const siteHex: string | undefined = dom?.site_adnl
    if (!siteHex) throw new Error('groupchat.ton has no ADNL site record yet')

    const conn = await this.rpc.call('adnl.connectByADNL', { adnl_id: hexToB64(siteHex) })
    this.peerId = conn.peer_id

    await this.rpc.call('overlay.join', {
      overlay_id: GROUPCHAT_OVERLAY_ID_B64,
      peer_id: this.peerId,
    })

    this.unsub = this.rpc.onEvent('overlay.message', (p) => {
      if (p?.overlay_id !== GROUPCHAT_OVERLAY_ID_B64) return
      try {
        const m = JSON.parse(b64ToUtf8(p.message)) as ChatMessage & { type?: string }
        if (m.type && m.type !== 'msg') return
        this.onMessage({
          nick: String(m.nick ?? '?'),
          text: String(m.text ?? ''),
          ts: Number(m.ts ?? Date.now()),
          self: false,
        })
      } catch {}
    })

    this.rpc
      .call('overlay.sendMessage', {
        overlay_id: GROUPCHAT_OVERLAY_ID_B64,
        data: utf8ToB64(JSON.stringify({ type: 'hello', ts: Date.now() })),
      })
      .catch(() => {})

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
    this.onMessage({ ...msg, self: true })
  }

  async disconnect(): Promise<void> {
    if (this.keepalive) clearInterval(this.keepalive)
    this.keepalive = undefined
    this.unsub?.()
    this.unsub = undefined
    try {
      await this.rpc.call('overlay.leave', { overlay_id: GROUPCHAT_OVERLAY_ID_B64 })
    } catch {}
    if (this.peerId) {
      try {
        await this.rpc.call('adnl.disconnect', { peer_id: this.peerId })
      } catch {}
      this.peerId = undefined
    }
  }
}
