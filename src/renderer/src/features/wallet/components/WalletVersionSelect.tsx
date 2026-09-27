import type { WalletAccountCandidate } from '@shared/ipc-contract/wallet'
import { cn } from '@/lib/utils'

export const WALLET_VERSION_OPTIONS = ['v5R1', 'v4R2', 'v3R2', 'v3R1'] as const
export type WalletVersionOption = (typeof WALLET_VERSION_OPTIONS)[number]

export function WalletVersionSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: WalletVersionOption
  onChange: (version: WalletVersionOption) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">Wallet version</label>
      <div className="grid grid-cols-2 gap-2">
        {WALLET_VERSION_OPTIONS.map((version) => (
          <button
            key={version}
            type="button"
            disabled={disabled}
            onClick={() => onChange(version)}
            className={cn(
              'rounded-control border px-3 py-2 text-left text-xs transition-colors',
              value === version
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border-subtle bg-elevation-1 text-muted-foreground hover:bg-surface-hover'
            )}
          >
            <span className="font-semibold">{version}</span>
            {version === 'v5R1' && <span className="mt-0.5 block text-[10px] text-muted-foreground">Recommended</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

export function pickDefaultAccount(candidates: WalletAccountCandidate[]): WalletAccountCandidate {
  return candidates.find((candidate) => candidate.version === 'v5R1') ?? candidates[0]
}
