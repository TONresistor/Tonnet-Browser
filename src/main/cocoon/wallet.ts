/**
 * Cocoon wallet operations: generation, derivation, signing helpers.
 *
 * Two wallets are managed:
 *  - owner_wallet : standard TON V4R2, holds the user's seed phrase
 *  - node_wallet  : custom cocoon_wallet.fc SC, controlled by a 32-byte Ed25519
 *                   secret (used by client-runner to send messages on behalf
 *                   of the user to its cocoon_client SC and to receive payouts)
 *
 * Wallet generation and address derivation are delegated to the standalone
 * `gocoon` CLI. The browser validates the returned JSON and persists it
 * encrypted.
 */

import { readFile } from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { Cell } from '@ton/core'
import { createLogger } from '../../shared/logger'
import { CocoonKeyStorage, type CocoonWalletData } from './wallet-storage'
import { getCocoonBinaryPath, getCocoonResource } from './paths'
import { toCocoonFundingAddress } from './funding-address'

const log = createLogger('cocoon:wallet')
const execFileAsync = promisify(execFile)

interface CocoonWalletCodeJson {
  hex: string
}

let cachedCodePromise: Promise<Cell> | null = null

export function getCocoonWalletCode(): Promise<Cell> {
  if (!cachedCodePromise) {
    const codePath = getCocoonResource('cocoon-wallet.code.json')
    cachedCodePromise = readFile(codePath, 'utf8').then((raw) => {
      const codeData = JSON.parse(raw) as CocoonWalletCodeJson
      return Cell.fromBoc(Buffer.from(codeData.hex, 'hex'))[0]
    })
  }
  return cachedCodePromise
}

let storageSingleton: CocoonKeyStorage | null = null

function getStorage(): CocoonKeyStorage {
  if (!storageSingleton) storageSingleton = new CocoonKeyStorage()
  return storageSingleton
}

/**
 * Generate a brand new Cocoon wallet pair and persist it (encrypted).
 * Returns the public-safe view of the data plus the mnemonic words for one-time
 * display to the user. The mnemonic is also stored on disk encrypted; this
 * return value just lets the UI show it without re-loading.
 *
 * Throws if a wallet already exists on disk.
 */
export async function generateCocoonWallet(): Promise<{
  ownerAddress: string
  nodeAddress: string
  mnemonic: string[]
}> {
  const storage = getStorage()
  if (await storage.exists()) {
    throw new Error('Cocoon wallet already exists')
  }

  const data = await generateCocoonWalletData()

  await storage.save(data)
  log.info(`Generated Cocoon wallet: owner=${data.ownerAddress.slice(0, 8)}… node=${data.nodeAddress.slice(0, 8)}…`)

  return {
    ownerAddress: toCocoonFundingAddress(data.ownerAddress),
    nodeAddress: data.nodeAddress,
    mnemonic: data.ownerMnemonic,
  }
}

/**
 * Generate the Cocoon wallet bundle via the standalone gocoon CLI.
 * This keeps wallet generation owned by the open-source Go client; the browser
 * only validates and persists the returned bundle.
 */
async function generateCocoonWalletData(): Promise<CocoonWalletData> {
  const binPath = getCocoonBinaryPath('cli')
  const walletCodePath = getCocoonResource('cocoon-wallet.code.json')
  const { stdout } = await execFileAsync(binPath, ['wallet', 'generate', '--wallet-code', walletCodePath], {
    encoding: 'utf8',
    maxBuffer: 128 * 1024,
    windowsHide: true,
  })
  return parseGeneratedWallet(String(stdout))
}

function parseGeneratedWallet(stdout: string): CocoonWalletData {
  const parsed = JSON.parse(stdout) as Partial<CocoonWalletData>
  if (!Array.isArray(parsed.ownerMnemonic) || parsed.ownerMnemonic.length !== 24) {
    throw new Error('Invalid gocoon wallet output: ownerMnemonic must contain 24 words')
  }
  if (typeof parsed.nodeSecretBase64 !== 'string' || Buffer.from(parsed.nodeSecretBase64, 'base64').length !== 32) {
    throw new Error('Invalid gocoon wallet output: nodeSecretBase64 must encode 32 bytes')
  }
  if (typeof parsed.nodePublicKeyHex !== 'string' || !/^[0-9a-f]{64}$/i.test(parsed.nodePublicKeyHex)) {
    throw new Error('Invalid gocoon wallet output: nodePublicKeyHex must be 32 bytes hex')
  }
  if (typeof parsed.ownerAddress !== 'string' || parsed.ownerAddress.length === 0) {
    throw new Error('Invalid gocoon wallet output: ownerAddress missing')
  }
  if (typeof parsed.nodeAddress !== 'string' || parsed.nodeAddress.length === 0) {
    throw new Error('Invalid gocoon wallet output: nodeAddress missing')
  }
  if (typeof parsed.createdAt !== 'number' || !Number.isFinite(parsed.createdAt)) {
    throw new Error('Invalid gocoon wallet output: createdAt missing')
  }
  return {
    ownerMnemonic: parsed.ownerMnemonic,
    nodeSecretBase64: parsed.nodeSecretBase64,
    nodePublicKeyHex: parsed.nodePublicKeyHex,
    ownerAddress: parsed.ownerAddress,
    nodeAddress: parsed.nodeAddress,
    createdAt: parsed.createdAt,
    setupCompletedAt: parsed.setupCompletedAt ?? null,
  }
}

/**
 * Load the wallet from disk. Returns null if the wallet does not exist.
 * Returned secrets are sensitive: callers MUST keep them in main process,
 * never expose to the renderer.
 */
export async function loadCocoonWallet(): Promise<CocoonWalletData | null> {
  return getStorage().load()
}

/** True iff a Cocoon wallet exists on disk. */
export async function hasCocoonWallet(): Promise<boolean> {
  return getStorage().exists()
}

/**
 * Get the node wallet secret as a raw 32-byte Buffer.
 * Used by sendFromCocoonWallet to sign external messages.
 */
export async function getNodeSecretBuffer(): Promise<Buffer> {
  const data = await loadCocoonWallet()
  if (!data) throw new Error('Cocoon wallet not initialized')
  const buf = Buffer.from(data.nodeSecretBase64, 'base64')
  if (buf.length !== 32) {
    throw new Error(`Invalid node secret length: expected 32 bytes, got ${buf.length}`)
  }
  return buf
}

/**
 * Public-safe summary of the wallet for the renderer.
 * Returns addresses, timestamps, and setup state; secrets are never returned across IPC.
 *
 * `setupCompletedAt` is null while the user is still in the setup wizard (wallet
 * generated but stake not yet deposited / runner not started). Once the wizard
 * finishes successfully, `markSetupComplete()` sets it to a timestamp.
 */
export async function getCocoonWalletInfo(): Promise<{
  ownerAddress: string
  nodeAddress: string
  nodePublicKeyHex: string
  createdAt: number
  setupCompletedAt: number | null
} | null> {
  const data = await loadCocoonWallet()
  if (!data) return null
  return {
    ownerAddress: toCocoonFundingAddress(data.ownerAddress),
    nodeAddress: data.nodeAddress,
    nodePublicKeyHex: data.nodePublicKeyHex,
    createdAt: data.createdAt,
    setupCompletedAt: data.setupCompletedAt ?? null,
  }
}

/**
 * Mark the setup wizard as completed. Called from the IPC handler after Step 4
 * (Stake & Start) finishes successfully. The flag is persisted so a browser
 * restart resumes the wizard at the correct step instead of jumping to chat.
 */
export async function markSetupComplete(): Promise<void> {
  const storage = getStorage()
  const data = await storage.load()
  if (!data) throw new Error('Cocoon wallet not initialized')
  if (data.setupCompletedAt) return // already marked, no-op
  const updated: CocoonWalletData = { ...data, setupCompletedAt: Date.now() }
  await storage.update(updated)
  log.info('Cocoon setup marked complete')
}

/**
 * Reveal the mnemonic words for backup display. Caller is responsible for
 * gating this behind a re-auth prompt.
 */
export async function exportCocoonMnemonic(): Promise<string[]> {
  const data = await loadCocoonWallet()
  if (!data) throw new Error('Cocoon wallet not initialized')
  return [...data.ownerMnemonic]
}

/**
 * Permanently delete the Cocoon wallet from disk.
 * The caller MUST ensure the user has unstaked first (otherwise their TON is
 * locked in the cocoon_client SC and unrecoverable without the node key).
 */
export async function deleteCocoonWallet(): Promise<void> {
  await getStorage().deleteFile()
  log.info('Cocoon wallet deleted')
}
