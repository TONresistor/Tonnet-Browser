import { useState } from 'react'
import { LayoutGrid, List, LoaderCircle } from 'lucide-react'
import type { ZkResistorPool } from '@shared/types'
import gramIcon from '@/assets/gram.svg'
import zkResistorIcon from '@/assets/zkresistor.svg'
import { InsetGroup } from '@/components/ui/ios/InsetGroup'
import { browserNavigation } from '@/features/browser/navigation'
import { formatTokenUnits, zkResistorPoolUrl } from '../format'
import { useZkResistorCatalog } from '../useCatalog'

type PoolView = 'list' | 'card'

export default function ZkResistorPage() {
  const [view, setView] = useState<PoolView>('list')
  const { catalog, loading, error, reload } = useZkResistorCatalog()
  const pools = catalog?.pools ?? []

  return (
    <div className="h-full overflow-auto bg-background-secondary" style={{ fontFamily: 'Inter, sans-serif' }}>
      <main className="mx-auto max-w-5xl px-5 py-6">
        <header className="mb-7 flex items-center gap-3">
          <img src={zkResistorIcon} alt="" className="h-10 w-10 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-heading">ZKResistor</h1>
            <p className="text-[13px] text-muted-foreground">Privacy pools for GRAM</p>
          </div>
        </header>

        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">
            GRAM Pools <span className="ml-1 font-normal tabular-nums text-muted-foreground">{pools.length}</span>
          </h2>
          <button
            type="button"
            onClick={() => setView((current) => (current === 'list' ? 'card' : 'list'))}
            aria-label={view === 'list' ? 'Show card view' : 'Show list view'}
            title={view === 'list' ? 'Card view' : 'List view'}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            {view === 'list' ? <LayoutGrid className="h-4 w-4" /> : <List className="h-4 w-4" />}
          </button>
        </div>

        {loading && !catalog && (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
            <LoaderCircle className="h-5 w-5 animate-spin" />
            Reading deployed contracts
          </div>
        )}

        {error && (
          <div className="rounded-card border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => void reload()}
              disabled={loading}
              className="mt-2 font-medium underline underline-offset-2 disabled:opacity-50"
            >
              {loading ? 'Retrying…' : 'Retry'}
            </button>
          </div>
        )}

        {catalog && pools.length === 0 && !error && (
          <div className="py-20 text-center text-sm text-muted-foreground">No GRAM pools</div>
        )}

        {catalog && pools.length > 0 && view === 'list' && (
          <InsetGroup bodyClassName="divide-y divide-border-subtle">
            {pools.map((pool) => (
              <PoolRow key={pool.id} pool={pool} />
            ))}
          </InsetGroup>
        )}

        {catalog && pools.length > 0 && view === 'card' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pools.map((pool) => (
              <PoolCard key={pool.id} pool={pool} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

function PoolRow({ pool }: { pool: ZkResistorPool }) {
  return (
    <button
      type="button"
      onClick={() => browserNavigation.navigateActiveTab(zkResistorPoolUrl(pool.address))}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-hover"
    >
      <img src={gramIcon} alt="GRAM" className="h-10 w-10 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">
          {formatTokenUnits(pool.denomination, pool.decimals)} {pool.symbol}
        </span>
        <span className="block truncate text-xs text-muted-foreground">GRAM Pool</span>
      </span>
      <span className="hidden text-right sm:block">
        <span className="block text-[13px] font-medium text-foreground">
          {formatTokenUnits(pool.shieldedAmount, pool.decimals)} {pool.symbol}
        </span>
        <span className="block text-xs text-muted-foreground">{pool.shieldedDeposits} shielded</span>
      </span>
    </button>
  )
}

function PoolCard({ pool }: { pool: ZkResistorPool }) {
  return (
    <button
      type="button"
      onClick={() => browserNavigation.navigateActiveTab(zkResistorPoolUrl(pool.address))}
      className="rounded-card border border-border-subtle bg-card p-3.5 text-left transition-colors hover:bg-surface-hover"
    >
      <div className="flex items-center gap-3">
        <img src={gramIcon} alt="GRAM" className="h-10 w-10 shrink-0" />
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-sm font-semibold text-foreground">
            {formatTokenUnits(pool.denomination, pool.decimals)} {pool.symbol}
          </strong>
          <span className="block truncate text-xs text-muted-foreground">GRAM Pool</span>
        </span>
        <span className="shrink-0 text-right">
          <strong className="block text-sm font-semibold text-foreground tabular-nums">
            {pool.shieldedDeposits.toLocaleString()}
          </strong>
          <span className="block text-[11px] text-muted-foreground">Privacy set</span>
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border-subtle pt-3">
        <span className="text-xs text-muted-foreground">Total Shielded</span>
        <strong className="truncate text-[13px] font-semibold text-foreground tabular-nums">
          {formatTokenUnits(pool.shieldedAmount, pool.decimals)} {pool.symbol}
        </strong>
      </div>
    </button>
  )
}
