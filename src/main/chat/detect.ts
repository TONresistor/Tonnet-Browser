import type { TonIndexerClient } from '../indexer/client'

const TON_DNS_COLLECTION = '0:b774d95eb20543f186c06b371ab88ad704f7e256130caf96189368a7d0cb6ccf'

export async function ownedDomains(indexer: TonIndexerClient, address: string): Promise<string[]> {
  if (!address) return []
  const items = await indexer.getNftItems({
    ownerAddress: address,
    collectionAddress: TON_DNS_COLLECTION,
    limit: 100,
  })
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
