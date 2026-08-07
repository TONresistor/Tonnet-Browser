import { WsBridgeClient } from './ws-bridge-client'

const CONNECT_ATTEMPTS = 20
const CONNECT_RETRY_MS = 100

export async function connectWalletBridge(bridge: WsBridgeClient): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < CONNECT_ATTEMPTS; attempt += 1) {
    try {
      await bridge.connect()
      return
    } catch (error) {
      lastError = error
      if (attempt < CONNECT_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, CONNECT_RETRY_MS))
      }
    }
  }
  throw lastError
}

export async function prepareWalletBridge(
  previous: WsBridgeClient,
  previousPort: number | null,
  nextPort: number
): Promise<WsBridgeClient> {
  if (previousPort === nextPort) {
    await connectWalletBridge(previous)
    return previous
  }
  const next = new WsBridgeClient(nextPort)
  try {
    await connectWalletBridge(next)
    return next
  } catch (error) {
    next.disconnect()
    throw error
  }
}

export async function warmupWalletBridge(getBalance: () => Promise<string>): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await getBalance()
      return true
    } catch {
      if (attempt < 9) {
        const delay = Math.min(500 * Math.pow(2, attempt), 5_000)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }
  return false
}
