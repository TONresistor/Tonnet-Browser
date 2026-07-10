/**
 * Full-page Cocoon wallet surface for the normal stake lifecycle.
 */

import { StakePanel } from './StakePanel'

export function CocoonWalletView() {
  return (
    <div className="min-w-0 flex-1 overflow-auto bg-background-secondary">
      <div className="mx-auto w-full max-w-xl space-y-5 px-8 py-7">
        <div className="border-b border-border-subtle pb-5 text-center">
          <h1 className="text-xl font-semibold text-foreground">Cocoon Wallet</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Balance, stake and withdrawal in one place.</p>
        </div>

        <StakePanel />
      </div>
    </div>
  )
}
