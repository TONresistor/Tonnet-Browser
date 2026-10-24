import { walletClient } from './client'

let activeUsers = 0
let timer: ReturnType<typeof setInterval> | null = null

function update(active: boolean): void {
  void walletClient.setPageOpen(active).catch(() => {
    // The main-process lease expires if the renderer or IPC becomes unavailable.
  })
}

export function retainWalletActivity(): () => void {
  if (!walletClient.isAvailable()) return () => {}
  if (activeUsers++ === 0) {
    update(true)
    timer = setInterval(() => update(true), 15_000)
  }
  let released = false
  return () => {
    if (released) return
    released = true
    if (--activeUsers === 0) {
      if (timer) clearInterval(timer)
      timer = null
      update(false)
    }
  }
}

export async function withWalletActivity<T>(operation: () => Promise<T>): Promise<T> {
  const release = retainWalletActivity()
  try {
    return await operation()
  } finally {
    release()
  }
}
