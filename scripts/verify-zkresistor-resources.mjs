import { readFileSync } from 'node:fs'
const manifest = JSON.parse(readFileSync(new URL('../resources/zkresistor/manifest.json', import.meta.url), 'utf8'))
const names = ['hasher.wasm', 'insert.wasm', 'insert_final.zkey', 'withdraw.wasm', 'withdraw_final.zkey']
const revision = 'recipient-binding-20260711'
if (
  manifest.schemaVersion !== 1 ||
  manifest.protocolRevision !== revision ||
  manifest.sdkVersion !== '2.0.1' ||
  manifest.factoryAddress !== 'EQB8W1W276GWiQpK88Sx46K20rsMrCKIezOpwFGJ4dhjWz58' ||
  manifest.baseUrl !== `https://github.com/TONresistor/zk-resistor-contracts/releases/download/circuits-${revision}/` ||
  Object.keys(manifest.files).length !== names.length
)
  throw new Error('Invalid ZKR resource manifest')
for (const name of names) {
  const file = manifest.files[name]
  if (!file || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.byteLength) || file.byteLength <= 0) {
    throw new Error(`Invalid ZKR resource pin: ${name}`)
  }
}
console.log('Verified five pinned ZKR download resources; no circuit binaries required for build')
