# Messenger cross-language fixtures

`messenger-go-vectors.json` is the frozen output of the Go Messenger broadcast
implementation from `TONresistor/tonnet-messenger`, covering the broadcast ID,
Ed25519 envelope and broadcast signatures, certificate encoding, and complete
wire serialization.

The fixture is vendored here so clean CI checkouts cannot silently skip
protocol compatibility tests when a sibling Messenger checkout is absent.
Updating it requires regenerating the vector with the Go producer, reviewing
the byte-level diff, and documenting the compatibility decision.
