# Messenger compatibility

The Browser `groupchat` branch expects this coordinated Messenger stack:

| Browser | Messenger node | WS Bridge | Wire |
|---|---|---|---|
| 2.6.0 `groupchat` | v0.3.1 pending release | v0.5.0 | `tonnet.broadcast` + `tonnet.envelopeV4` |

Required Bridge capabilities are `dht.findOverlayNodes` with `adnl_id`,
liveness-checked `adnl.connectByADNL`, and direct boxed-TL `overlay.query` for
both `tonnet.getTime` and the per-connection `tonnet.getChallenge`.
Browser rejects a candidate if `tonnet.getTime` fails or differs by more than
five minutes.

Bridge v0.5.0 already provides these capabilities and is pinned in
`scripts/binary-versions.json`. Publish Messenger node v0.3.1 before merging or
releasing this Browser work.
