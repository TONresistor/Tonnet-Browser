import type { WalletAccountCandidate } from '@shared/ipc-contract/wallet'
import { formatTonAmount } from '@/lib/ton-utils'
import { cn } from '@/lib/utils'

export function WalletAccountCandidates({
  candidates,
  selected,
  onSelect,
}: {
  candidates: WalletAccountCandidate[]
  selected: WalletAccountCandidate | null
  onSelect: (candidate: WalletAccountCandidate) => void
}) {
  if (candidates.length === 0) return null
  return (
    <div className="space-y-2">
      {candidates.map((candidate) => (
        <button
          key={candidate.version}
          type="button"
          onClick={() => onSelect(candidate)}
          className={cn(
            'w-full rounded-control border px-3 py-2 text-left text-xs transition-colors',
            selected?.version === candidate.version
              ? 'border-primary bg-primary/10'
              : 'border-border-subtle bg-elevation-1 hover:bg-surface-hover'
          )}
        >
          <span className="font-semibold text-foreground">{candidate.version} · TON wallet</span>
          <span className="ml-2 text-muted-foreground">
            {candidate.balance === null ? 'Balance unavailable' : `${formatTonAmount(candidate.balance)} GRAM`}
          </span>
          <span className="mt-1 block truncate font-mono text-muted-foreground">{candidate.address}</span>
        </button>
      ))}
    </div>
  )
}
