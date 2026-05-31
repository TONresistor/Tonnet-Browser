# Vendored Wrappers

## Source

Repository: https://github.com/TelegramMessenger/cocoon-contracts
Commit: edafcb2b9a74403ba343e0826772af77ec431277
Date vendored: 2026-04-27

## Vendored files

- `CocoonWallet.ts` — wallet contract wrapper
- `CocoonClient.ts` — client contract wrapper
- `CocoonRoot.ts` — root registry contract wrapper
- `LICENSE.upstream` — upstream Apache 2.0 license

`CocoonProxy.ts` and `CocoonWorker.ts` are intentionally not vendored here:
the browser does not import them in the active Cocoon flow, and `CocoonProxy.ts`
pulls in `@ton/sandbox` test helpers that are not a runtime dependency.

## Reason for vendoring

The cocoon-contracts repository is not published to npm. Vendoring avoids a
runtime npm dependency on an unpublished git repo and keeps the build
hermetic.

## License

Apache License 2.0 — see `LICENSE.upstream`.

## Update procedure

```sh
# Run from anywhere inside this repo so DEST resolves to your checkout.
DEST="$(git rev-parse --show-toplevel)/src/main/cocoon/contracts/wrappers"
cd /tmp
rm -rf cocoon-contracts
git clone https://github.com/TelegramMessenger/cocoon-contracts
NEW_COMMIT=$(git -C cocoon-contracts rev-parse HEAD)
cp cocoon-contracts/wrappers/CocoonWallet.ts   $DEST/CocoonWallet.ts
cp cocoon-contracts/wrappers/CocoonClient.ts   $DEST/CocoonClient.ts
cp cocoon-contracts/wrappers/CocoonRoot.ts     $DEST/CocoonRoot.ts
cp cocoon-contracts/LICENSE                    $DEST/LICENSE.upstream
```

After copying, re-add the `VENDORED FROM` header comment block to each `.ts`
file (first 7 lines) and update the commit hash in this file and in each
header. Re-run `npm run type-check && npm run test` to confirm no breakage.
