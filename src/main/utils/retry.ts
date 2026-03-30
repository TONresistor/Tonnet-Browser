import { createLogger } from '../../shared/logger'

const log = createLogger('wallet:rpc')

const MAX_RETRIES = 3
const BASE_DELAY_MS = 2000

export async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (error: any) {
      const is429 = error?.status === 429 || error?.response?.status === 429 || String(error?.message).includes('429')
      if (is429 && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt)
        log.warn(`${label}: rate limited (429), retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`)
        await new Promise((r) => setTimeout(r, delay))
        continue
      }
      throw error
    }
  }
  throw new Error(`${label}: max retries exceeded`)
}
