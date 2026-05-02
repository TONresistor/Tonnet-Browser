const fs = require('fs')
const path = require('path')
const { app, safeStorage } = require('electron')

const userData = process.env.TON_BROWSER_USER_DATA || '/home/anon/.config/ton-browser'
app.setName('TON Browser')
app.setPath('userData', userData)

function decryptJson(fileName) {
  const filePath = path.join(userData, fileName)
  if (!fs.existsSync(filePath)) return null
  const buf = fs.readFileSync(filePath)
  if (!buf.subarray(0, 4).equals(Buffer.from('SENC'))) {
    throw new Error(`${fileName}: missing SENC marker`)
  }
  return JSON.parse(safeStorage.decryptString(buf.subarray(4)))
}

function redactWallet(data) {
  if (!data) return null
  return {
    ownerAddress: data.ownerAddress,
    nodeAddress: data.nodeAddress,
    nodePublicKeyHex: data.nodePublicKeyHex,
    createdAt: data.createdAt,
    setupCompletedAt: data.setupCompletedAt ?? null,
    hasOwnerMnemonic: Array.isArray(data.ownerMnemonic) && data.ownerMnemonic.length === 24,
    hasNodeSecret: typeof data.nodeSecretBase64 === 'string' && data.nodeSecretBase64.length > 0,
  }
}

function redactArchive(data) {
  return {
    entries: (data?.entries ?? []).map((entry) => ({
      archivedAt: entry.archivedAt,
      ownerAddress: entry.ownerAddress,
      nodeAddress: entry.nodeAddress,
      nodePublicKeyHex: entry.nodePublicKeyHex,
      lastClientSCAddress: entry.lastClientSCAddress ?? null,
      hasOwnerMnemonic: Array.isArray(entry.ownerMnemonic) && entry.ownerMnemonic.length === 24,
      hasNodeSecret: typeof entry.nodeSecretBase64 === 'string' && entry.nodeSecretBase64.length > 0,
    })),
  }
}

app
  .whenReady()
  .then(() => {
    const result = {
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
      userData,
      wallet: redactWallet(decryptJson('cocoon-wallet.dat')),
      archive: redactArchive(decryptJson('cocoon-archive.dat')),
      recoveryQueue: decryptJson('cocoon-recovery-queue.dat') ?? { entries: [] },
    }
    console.log(JSON.stringify(result, null, 2))
  })
  .catch((err) => {
    console.error(err?.stack || err?.message || String(err))
    process.exitCode = 1
  })
  .finally(() => app.quit())
