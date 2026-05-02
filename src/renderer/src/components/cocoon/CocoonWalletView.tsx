/**
 * Full-page Cocoon wallet surface for the normal stake lifecycle.
 */

import { StakePanel } from './StakePanel'

export function CocoonWalletView() {
  return (
    <div className="flex-1 min-w-0 overflow-auto bg-background-secondary">
      <div className="mx-auto w-full max-w-xl px-8 py-7 space-y-5">
        <div className="flex flex-col items-center gap-3 border-b border-border pb-5 text-center">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground">Cocoon Wallet</h1>
            <p className="text-sm text-foreground-muted mt-0.5">Balance, stake and withdrawal in one place.</p>
          </div>
        </div>

        <StakePanel />
      </div>
    </div>
  )
}
