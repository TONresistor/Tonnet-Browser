/**
 * Typed HTTP client for the cocoon-runner control plane.
 *
 * The runner exposes a small JSON+text API on its HTTP port (default 10000).
 * We use four endpoints:
 *
 *   GET /jsonstats                       — full status snapshot
 *   GET /request/close?proxy=<addr>      — owner_client_request_refund
 *   GET /request/withdraw?proxy=<addr>   — owner_client_withdraw (skim balance > stake)
 *   GET /request/topup?proxy=<addr>      — ext_client_top_up
 *
 * The /request/* endpoints reply with a small HTML page produced by
 * wrap_short_answer_to_http() upstream:
 *
 *   <!DOCTYPE html><html><body>
 *   <text><br/>
 *   <a href="/stats">return to stats</a>
 *   </html></body>
 *
 * `<text>` is "request sent" on success or a free-form error string ("proxy not
 * found", "request is already running", etc.). We strip HTML and match
 * case-insensitively.
 */

import { createLogger } from '../../shared/logger'

const log = createLogger('cocoon:runner-api')

const DEFAULT_TIMEOUT_MS = 10_000

/** Shape of a single proxy entry in /jsonstats `proxies[]`. */
export interface RunnerProxyStat {
  proxy_sc_address: string
  proxy_public_key: string
  /** Address of the cocoon_client SC for this user on this proxy. */
  sc_address: string
  /** On-chain client SC state: 0=normal, 1=closing, 2=closed. */
  state: 0 | 1 | 2
  tokens_used_proxy_committed_to_blockchain: number
  tokens_used_proxy_committed_to_db: number
  tokens_used_proxy_max: number
  tokens_charged: number
  tokens_payed: number
}

/** Shape of /jsonstats response (fields we read). */
export interface RunnerJsonStats {
  status: {
    wallet_balance?: number | string
    ton_last_synced_at?: number
    enabled?: boolean
    git_commit?: string
  }
  localconf: {
    root_address: string
    owner_address: string
    check_image_hashes?: boolean
  }
  proxy_connections: Array<{
    address: string
    is_ready: boolean
    proxy_sc_address?: string
  }>
  proxies: RunnerProxyStat[]
}

/**
 * Fetch /jsonstats and return the parsed snapshot.
 * Throws on network error, non-200 status, or invalid JSON.
 */
export async function fetchJsonStats(httpPort: number, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<RunnerJsonStats> {
  const url = `http://127.0.0.1:${httpPort}/jsonstats`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) {
      throw new Error(`/jsonstats returned ${res.status} ${res.statusText}`)
    }
    const data = (await res.json()) as RunnerJsonStats
    return data
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Hit a control endpoint that takes a `proxy=<addr>` query param and replies
 * with the runner's short-answer wrapper. Resolves on 200 with the trimmed
 * body text; rejects on transport error, non-200, or a body whose first word
 * looks like an error indicator.
 *
 * Upstream wrap_short_answer_to_http() returns either:
 *   "request sent\n"        — happy path (cmd_close, cmd_top_up, cmd_withdraw)
 *   "<error message>\n"     — failure (e.g. "proxy not found", "request is already running")
 *
 * Since the wrapper does not encode a structured status, we treat the literal
 * "request sent" as the success marker and bubble anything else as an error.
 */
/**
 * Strip HTML tags + collapse whitespace from the runner's wrap_short_answer body
 * to recover the inner status text.
 */
function extractAnswer(body: string): string {
  return body
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function callRunnerControl(
  httpPort: number,
  endpoint: 'close' | 'withdraw' | 'topup',
  proxySCAddress: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<void> {
  const url = `http://127.0.0.1:${httpPort}/request/${endpoint}?proxy=${encodeURIComponent(proxySCAddress)}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) {
      throw new Error(`/request/${endpoint} returned ${res.status} ${res.statusText}`)
    }
    const answer = extractAnswer(await res.text())
    if (!/request sent/i.test(answer)) {
      throw new Error(`runner /request/${endpoint} rejected: ${answer || '(empty body)'}`)
    }
    log.info(`runner /request/${endpoint} OK (proxy=${proxySCAddress.slice(0, 8)}…)`)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Trigger `owner_client_request_refund` on the client SC associated with the
 * given proxy. The runner signs and broadcasts using the cocoon node wallet.
 *
 * Behavior depends on the on-chain client state:
 *   - state=normal (0): SC transitions to closing, sets unlock_ts, refunds
 *     `balance - stake` immediately.
 *   - state=closing (1): only succeeds once unlock_ts < now(); SC transitions
 *     to closed, the staked amount is refunded.
 *   - state=closed (2): the runner / contract will reject.
 */
export async function requestRefund(httpPort: number, proxySCAddress: string): Promise<void> {
  await callRunnerControl(httpPort, 'close', proxySCAddress)
}
