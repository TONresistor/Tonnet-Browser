const TON_DNS_COLLECTION = '0:b774d95eb20543f186c06b371ab88ad704f7e256130caf96189368a7d0cb6ccf'

interface NftItem {
  content?: { domain?: string } | null
}

export async function ownedDomains(address: string, endpoint: string, apiKey?: string): Promise<string[]> {
  if (!address || !endpoint) return []
  const base = endpoint.replace(/\/+$/, '')
  const url =
    `${base}/nft/items?owner_address=${encodeURIComponent(address)}` +
    `&collection_address=${encodeURIComponent(TON_DNS_COLLECTION)}&limit=100`
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (apiKey) headers['X-Api-Key'] = apiKey
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) })
  if (!res.ok) throw new Error(`nft items HTTP ${res.status}`)
  const data = (await res.json()) as { nft_items?: NftItem[] }
  const items = Array.isArray(data.nft_items) ? data.nft_items : []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const raw = item.content?.domain
    if (typeof raw !== 'string') continue
    const name = raw.trim().toLowerCase()
    if (name.endsWith('.ton') && !seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}
