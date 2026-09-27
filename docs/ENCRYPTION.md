# Payload encryption

How the Browser encrypts and decrypts message payloads: transfer memos that
travel on chain, and arbitrary data exchanged with TON Sites over TON Connect.

Both use the same cipher construction, called `ton-simple-v2` throughout this
document. It is the scheme implemented by tonlib `SimpleEncryptionV2` and
mirrored by the toncenter `ton-wallet` reference. Only the transport differs.

## Decisions

| Decision                                                  | Rationale                                                                                                              |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| TON Connect payloads carry the raw envelope, base64        | Matches the protocol wording, the reference SDK demo, and Tonkeeper. A BOC wrapper is not interoperable                  |
| `0x2167da4b` is reserved for on-chain message bodies       | It is a message-body opcode that tells wallets to render encrypted text. Off chain there is nothing to tag              |
| `@noble/curves` supplies X25519                            | Audited, constant-time, validates points, and rejects all-zero shared secrets. The same library the other TON wallets use |

The first decision is what makes cross-wallet decryption work at all. A
recipient given a BOC cannot tell whether the leading bytes are a cell header
or the start of the public-key difference, so the two encodings cannot coexist
on one field.

## The envelope

```
sharedSecret = X25519(edwardsToMontgomeryPriv(seed32), edwardsToMontgomeryPub(peerEdPub))
padded       = randomPrefix || plaintext
salt         = utf8(senderAddress.toString({ bounceable: true, urlSafe: true, testOnly: false }))
msgKey       = HMAC-SHA512(salt, padded)[0:16]
kdf          = HMAC-SHA512(sharedSecret, msgKey)
ciphertext   = AES-256-CBC(kdf[0:32], kdf[32:48], padded)
envelope     = (myPub XOR peerPub) || msgKey || ciphertext
```

`randomPrefix` is at least 16 bytes, its first byte records its own length, and
its length is chosen so that `padded` is a multiple of the 16-byte AES block.
CBC padding is disabled because the prefix already provides the alignment.

The public keys are Ed25519 wallet keys. Storing their XOR rather than the
sender key alone lets either party recover the other from its own key while
revealing neither to an observer who knows neither.

`msgKey` doubles as the integrity tag: a recipient recomputes
`HMAC-SHA512(salt, decrypted)[0:16]` and compares it in constant time. This
binds the ciphertext to the salt, so a wrong sender address fails closed rather
than yielding garbage.

### Transports

| Transport | Encoding                                                            | Used by                                     |
| --------- | ------------------------------------------------------------------- | ------------------------------------------- |
| Off chain | `base64(envelope)`                                                   | TON Connect `encryptData` and `decryptData` |
| On chain  | `storeUint(0x2167da4b, 32)` then the envelope as a snake tail        | Encrypted transfer memos                    |

The on-chain snake layout puts the opcode plus the first 35 bytes in the root
cell and 127 bytes in each subsequent reference. That 35-byte root is the
convention every TON wallet expects; a generic string-tail encoder would fill
the root with 127 bytes and produce a body other wallets split differently.

## Salt selection

The salt is always the address of whoever **encrypted** the payload. It is
never the recipient and never "the current wallet" by default.

| Situation                        | Salt                               |
| -------------------------------- | ---------------------------------- |
| Encrypting a memo to send        | Our own wallet address             |
| Decrypting a memo we sent        | Our own wallet address             |
| Decrypting a memo we received    | The counterparty (`in_msg.source`) |
| TON Connect `encryptData`        | Our own wallet address             |
| TON Connect `decryptData`        | The request's `salt` field         |

Addresses arrive from the bridge and the indexer in raw form and must be
normalized to bounceable, URL-safe, non-testnet before being hashed. A memo
decrypts only when the salt matches byte for byte.

### `salt` is not `from`

On TON Connect these are different fields with different jobs, and conflating
them breaks cross-sender decryption.

- `from` is the account selector shared by every TON Connect method: which of
  the connected accounts should perform this operation. It is validated against
  the connected wallet.
- `salt` is a KDF input naming whoever encrypted the data.

They coincide on `encryptData`, because there the wallet is the sender, which
is why the protocol defines no `salt` field for it. On `decryptData` the wallet
is the recipient, so the two normally differ. The Browser validates each
independently and never compares them.

## What exists today

`src/main/wallet/encrypted-comment.ts` implements encryption only, for on-chain
memos only. `createEncryptedCommentBody` performs padding, key agreement,
encryption, and cell packing in one function, over a hand-written BigInt
Montgomery ladder. The recipient's key comes from an on-chain `get_public_key`
call made by `prepareEncryptedComment`, and the salt is fixed to the signing
wallet's address.

Nothing decrypts. `decodeCommentBody` returns `undefined` for any opcode other
than zero, so a received encrypted memo renders blank, and TON Connect
advertises only `SendTransaction` and `SignData`.

## What is added

The crypto moves to `src/main/wallet/ton-encryption/`, split by concern so the
two transports cannot drift apart:

| Module            | Responsibility                                                           |
| ----------------- | ------------------------------------------------------------------------ |
| `x25519.ts`       | Ed25519 to X25519 conversion and the shared secret, over `@noble/curves`  |
| `envelope.ts`     | `encryptEnvelope` and `decryptEnvelope`, transport free, bytes in and out |
| `comment-body.ts` | The `0x2167da4b` snake body: encode and decode                            |

`encrypted-comment.ts` stays as a re-export so existing call sites keep working.
The hand-rolled ladder is deleted; `@noble/curves` brings point validation, a
constant-time ladder, and rejection of all-zero shared secrets, none of which
the previous code had.

Decryption arrives in two places. Memos gain a `WALLET_DECRYPT_COMMENT` channel
served by `WalletEncryptionService`, driven on demand from the transaction
detail view rather than during background sync, because the key is needed and
the wallet may be locked. TON Connect gains `encryptData` and `decryptData`,
advertised as features and gated by the same approval overlay the other signing
methods use.

Decrypted plaintext for received memos is held in renderer memory only. It is
not written to the history file, which would otherwise accumulate counterparty
plaintext on disk as a side effect of viewing a transaction.

## Interoperability

The three implementations agree on the envelope. They differ, or differed, in
how it is framed and in what the RPC surface looks like.

| Concern                     | Browser                  | factory `sdk-wallet`             | `tonkeeper-web`         |
| --------------------------- | ------------------------ | -------------------------------- | ----------------------- |
| TON Connect payload framing | Raw envelope             | Was a BOC with the opcode        | Raw envelope            |
| Request shape               | Spec payload object      | Was positional arguments         | Spec payload object     |
| Plaintext type              | Base64 bytes             | Was UTF-8 text                   | Base64 bytes            |
| Decrypt result              | Base64 bytes             | Was decoded text, lossy          | Base64 bytes            |
| X25519                      | `@noble/curves`          | `@noble/curves`                  | `@noble/curves`         |
| On-chain memo support       | Encrypt and decrypt      | Encrypt only, for message bodies | Codec present, unwired  |

Deviations corrected as part of this work:

- `sdk-wallet` returned a BOC from `encryptData` and required one on
  `decryptData`, so it could not exchange payloads with any other wallet. It now
  emits and prefers the raw envelope, still accepting the older BOC and
  JSON-array forms on input.
- `sdk-wallet` decoded decrypted bytes with `TextDecoder`, which replaces every
  invalid UTF-8 sequence with U+FFFD. Binary payloads, including the wrapped
  symmetric keys the SDK exists to carry, were silently corrupted. It now
  returns bytes.
- `sdk-wallet` scanned the whole payload for `0x2167da4b` and split at every
  occurrence. Ciphertext is uniformly random, so that opcode can appear by
  chance. Only a leading opcode is stripped now.
- `tonkeeper-web` required `salt` to equal `from` on decrypt while the transport
  layer separately required `from` to equal the wallet address. Together those
  admitted only self-encrypted data. The `salt` comparison is removed.

## Threat model

The scheme provides confidentiality and integrity between two wallet key pairs,
and it authenticates the claimed sender address by binding it into `msgKey`.

Explicit non-goals:

- **No forward secrecy.** The shared secret is static for a pair of wallets, so
  a compromised seed retroactively decrypts every payload that wallet exchanged.
- **Sender identity is public.** The XOR of the two public keys is in the clear,
  so anyone holding either key learns the other.
- **Metadata is public.** For on-chain memos the addresses, amounts, and
  ciphertext length are visible to everyone.
- **`msgKey` is deterministic in the padded plaintext.** Identical plaintext,
  salt, and random prefix produce identical output. The random prefix is what
  keeps repeated memos from being recognizable, so its RNG matters.
- **No replay protection.** An envelope stays valid forever and can be
  re-attached to another message; only the sender address is bound.
- **Recipient keys are trusted on read.** `get_public_key` results come from the
  chain over the bridge without a proof, so a dishonest bridge could substitute
  a key and receive a memo intended for someone else.

Encrypted memos are capped at 256 bytes of plaintext by the send path, matching
the plaintext memo cap. The envelope adds 48 bytes plus up to 31 bytes of
padding, so a 256-byte memo yields a 320-byte body. The crypto module accepts up
to 960 bytes so that non-memo callers are not silently truncated.

## Test vectors

`src/main/wallet/ton-encryption/__tests__/vectors.json` pins a known-answer test
shared with the other implementations. Because `msgKey` derives from the padded
plaintext, output is only reproducible when the random prefix is fixed, so the
fixture pins the prefix and the encrypt path takes an injectable random source
for tests.

The fixture fixes the sender seed, recipient seed, sender address, plaintext,
and prefix, and records the expected envelope and the expected on-chain body.
Any change to padding, key derivation, cipher parameters, or cell layout breaks
it. Copying it into the other repositories turns cross-implementation drift into
a failing test rather than a payload that silently fails to decrypt in the field.
