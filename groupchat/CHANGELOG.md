# Groupchat — experimental change log

Everything done for the experimental P2P group chat feature, so we keep a trace and can roll back fast.

Branch: `groupchat` (off `dev`). Everything chat-related lives under `groupchat/`.

---

## Architecture (short)

- **Anchor** = a standalone Go daemon (`groupchat/anchor/`) running on the **<server>** server. It hosts one public overlay ("the room"), relays messages between connected peers (hub/star topology for the MVP), and publishes itself to the DHT so browser clients can find + reach it. **It is NOT the bridge and does not touch it.**
- **Browser client** = talks to the browser's already-bundled `tonutils-bridge` over its local WebSocket, using existing methods (`dns.resolve`, `adnl.connectByADNL`, `overlay.join`, `overlay.sendMessage`, `overlay.message` events). No change to the browser bridge is required for the MVP.
- **`groupchat.ton`** names the anchor: its DNS *site* record points at the anchor's ADNL id. Clients resolve it → connect → join the room.

The decentralized/P2P variant (real overlay broadcast instead of a hub) is planned for v2; the `overlay.broadcast` method already added to the `tonutils-bridge` repo is for that path and is **not** used by this MVP.

---

## KEY VALUES (record these)

```
Room name (overlay descriptor) : tonnet:groupchat:v1
Overlay id (base64)            : YNsvFzQZ4AKXJmBLLHrm4p2JmoATens+MJCXxCb8gZM=
Anchor ADNL id (base64)        : f+R0sAdNw5W1IbBNa7wO1D80n/vvT9fdugL7pPh56ZQ=
Anchor ADNL id (hex)           : 7fe474b0074dc395b521b04d6bbc0ed43f349ffbef4fd7ddba02fba4f879e994
Anchor public endpoint         : <server-ip>:17400/udp
```

**DNS action still to do (manual, on-chain):** set `groupchat.ton` *site* record → the anchor ADNL id above (`dns_adnl_address`, category `0xad01`). One transaction from the domain owner wallet.

---

## 2026-07-02 — Anchor deployed on <server>

### Local (this repo, `groupchat` branch)
- Added `groupchat/anchor/` — Go daemon (`main.go`, `go.mod`, `go.sum`). Hub relay + DHT self-publish. Persistent ed25519 key so the ADNL id is stable across restarts.
- Added `groupchat/browser/` — client module + wiring notes (see its README).
- Added this `groupchat/CHANGELOG.md`.

### Server: <server> (<server-ip>, Debian 13, Go 1.25.6) — all NEW, nothing existing touched
1. `/opt/groupchat-anchor/` — new dir: source + built binary `groupchat-anchor` + `anchor-key.bin` (the node identity — **back this up**; deleting it changes the ADNL id and breaks the DNS record).
2. `ufw allow 17400/udp` (comment "tonnet groupchat anchor") — opened the anchor's UDP port.
3. `/etc/systemd/system/groupchat-anchor.service` — new unit, `enable --now`. Runs:
   `groupchat-anchor -listen <server-ip>:17400 -key /opt/groupchat-anchor/anchor-key.bin`

Verified: service `active`; logs show `republished to DHT (address + overlay node)` and inbound peers connecting.

### NOT touched (important)
- `tonutils-bridge-custom` (prod, 127.0.0.1:8081) — untouched.
- `tonutils-reverse-proxy`, `tonutils-storage`, `<server>-node` liteserver, nginx, all `*.ton` site backends — untouched.

---

## 2026-07-02 — DNS record set + verified

`groupchat.ton` site record set on-chain and verified with `groupchat/tools/resolve-check`:

```
groupchat.ton -> site ADNL = 7fe474b0074dc395b521b04d6bbc0ed43f349ffbef4fd7ddba02fba4f879e994
              (= f+R0sAdNw5W1IbBNa7wO1D80n/vvT9fdugL7pPh56ZQ=, storage=false)  ✓ matches the anchor
```

Full discovery path is now live: `groupchat.ton` (on-chain) -> anchor ADNL -> DHT -> anchor endpoint.

**Remaining:** wire the browser UI (`ton://chat` route + chat panel using `groupchat/browser/groupchat-client.ts`). Everything else is deployed and verified.

---

## 2026-07-02 — Browser UI wired (`ton://chat`)

Full renderer integration, all type-checked + built (`npm run type-check`, `npm run build` green).

Files touched (outside `groupchat/`):
- `src/shared/groupchat.ts` — NEW: room/overlay/domain constants (overlay id must match the anchor).
- `src/shared/bridge-config.ts` — `DEFAULT_NAMESPACE_STATE`: enabled `adnl` + `overlay` + `dht` (chat needs them).
- `src/main/proxy/config-writer.ts` — also enforce those 3 namespaces on **existing** installs (applied on next bridge start).
- `src/shared/ipc-channels.ts` — `CHAT_CONNECT/SEND/DISCONNECT/MESSAGE`.
- `src/shared/ipc-events.ts` — `chat:message` event.
- `src/main/wallet/ws-bridge-client.ts` — `overlayConnectAndJoin` / `overlaySend` / `overlayLeaveAndDisconnect` / `onOverlayMessage`.
- `src/main/ipc/handlers/chat.ts` — NEW: resolve → connect → join → relay `overlay.message` to renderer.
- `src/main/ipc/handlers/index.ts` + `handlers.ts` — register chat handlers.
- `src/preload/index.ts` + `index.d.ts` — `window.electron.chat` + `chat:message` event.
- `src/renderer/src/components/pages/ChatPage.tsx` — NEW: the chat panel.
- `src/renderer/src/App.tsx` — route `ton://chat` → `<ChatPage/>`.

### How to test live e2e
1. Run the browser (`npm run dev`, or the built app). On bridge start the config-writer enables the `adnl/overlay/dht` namespaces automatically.
2. Make sure the proxy is connected (the chat uses the local bridge).
3. Go to `ton://chat`. It resolves `groupchat.ton` → anchor → joins the room.
4. Open a second instance (or another machine running the browser) → same room → send messages both ways.

Note: MVP relays live only (no history). Sender sees an optimistic local echo (anchor does not echo back).

## Rollback of the browser UI

```bash
git checkout dev            # abandon the branch, or:
git branch -D groupchat
```

To disable just the namespace change without dropping the branch, revert `src/shared/bridge-config.ts`
+ `src/main/proxy/config-writer.ts` and restart the bridge.

---

## Rollback (server) — removes the anchor completely

```bash
ssh <server>
systemctl disable --now groupchat-anchor.service
rm /etc/systemd/system/groupchat-anchor.service
systemctl daemon-reload
ufw delete allow 17400/udp
rm -rf /opt/groupchat-anchor
```

(Also revert the `groupchat.ton` DNS record if it was set.)

## Rollback (repo)

```bash
git checkout dev          # abandon the branch; or:
git branch -D groupchat   # delete it
```

## Common ops

```bash
ssh <server> 'systemctl status groupchat-anchor'
ssh <server> 'journalctl -u groupchat-anchor -f'
ssh <server> 'systemctl restart groupchat-anchor'   # ADNL id stays the same (key persists)
```

## Redeploy after editing anchor code

```bash
cd groupchat/anchor && go build -o /dev/null .     # sanity build
scp main.go <server>:/opt/groupchat-anchor/
ssh <server> 'cd /opt/groupchat-anchor && go build -o groupchat-anchor . && systemctl restart groupchat-anchor'
```
