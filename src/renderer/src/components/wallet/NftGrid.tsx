/**
 * NFT gallery grid for the wallet page.
 */

import { useState, useEffect, memo } from 'react'
import { LoaderCircle, ImagePlus } from 'lucide-react'
import { createLogger } from '@/logger'

const log = createLogger('wallet:nfts')

type NftItem = {
  address: string
  name: string
  description?: string
  image?: string
  collection?: string
}

export const NftGrid = memo(function NftGrid() {
  const [nfts, setNfts] = useState<NftItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.electron.wallet
      .getNfts()
      .then((items) => {
        setNfts(items)
        setLoading(false)
      })
      .catch((err) => {
        log.warn('Failed to load NFTs:', err)
        setLoading(false)
      })
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoaderCircle className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (nfts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
        <ImagePlus className="w-8 h-8" />
        <span className="text-sm">No NFTs found</span>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-3 gap-3">
      {nfts.map((nft) => (
        <div key={nft.address} className="glass-card overflow-hidden">
          {nft.image ? (
            <img src={nft.image} alt={nft.name} loading="lazy" className="aspect-square w-full object-cover bg-muted" />
          ) : (
            <div className="aspect-square w-full bg-muted flex items-center justify-center">
              <ImagePlus className="w-6 h-6 text-muted-foreground" />
            </div>
          )}
          <div className="p-2">
            <p className="text-sm font-medium text-foreground truncate">{nft.name}</p>
            {nft.collection && <p className="text-xs text-muted-foreground truncate">{nft.collection}</p>}
          </div>
        </div>
      ))}
    </div>
  )
})
