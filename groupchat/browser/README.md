# Groupchat — browser side (experimental)

`groupchat-client.ts` is a framework-agnostic client for the experimental group chat.
It uses **only existing** `tonutils-bridge` methods over the browser's local WS, so no
bridge change is needed for the MVP.

## Wiring (2 small steps)

### 1. Adapt your bridge WS client to `BridgeRPC`

```ts
const rpc: BridgeRPC = {
  call: (method, params) => yourBridge.request(method, params),   // -> resolves with `result`
  onEvent: (name, cb) => yourBridge.subscribe(name, cb),          // -> returns unsubscribe fn
}
```

Use whatever your app already uses to talk to the bridge on `ws://127.0.0.1:<wsPort>`
(the same channel used for `dns.resolve`, `adnl.*`, etc.).

### 2. Register a `ton://chat` internal route

Intercept `ton://chat` **before** DNS resolution (like `about:` pages) and mount a panel:

```ts
const client = new GroupchatClient(rpc, myNick, (m) => appendMessageToUI(m))
await client.connect()
// input box -> client.send(text)
// on close -> client.disconnect()
```

That's the whole integration surface. Keep it behind an "experimental features" flag.

## How it works

`ton://chat` → `dns.resolve('groupchat.ton')` → anchor ADNL id → `adnl.connectByADNL` →
`overlay.join` → the anchor (on gton) relays messages between all connected clients.
Incoming messages arrive as `overlay.message` events; outgoing go via `overlay.sendMessage`.

Message payload is JSON `{ nick, text, ts }` (base64 over the wire). The sender shows an
optimistic local echo (the anchor does not echo back to the sender).

## Constants that must match the anchor

- `GROUPCHAT_ROOM = "tonnet:groupchat:v1"`
- `GROUPCHAT_OVERLAY_ID_B64 = "YNsvFzQZ4AKXJmBLLHrm4p2JmoATens+MJCXxCb8gZM="`

These come from the anchor (`groupchat/anchor`), printed on startup. See `../CHANGELOG.md`.

## Limitations (MVP)

- Star topology through the single anchor (not yet real P2P broadcast — v2 will use the
  `overlay.broadcast` bridge method).
- No history: you see messages sent after you join.
- Self-declared nicks; ADNL identity is per-connection.
