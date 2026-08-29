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
