import type { CocoonState, RecoveryDriverEvent, WithdrawDriverEvent } from '@shared/cocoon-types'

/** Typed main-process boundary owned by the Cocoon feature. */
export const cocoonClient = {
  availability: () => window.electron.cocoon.availability(),
  status: () => window.electron.cocoon.status(),
  start: () => window.electron.cocoon.start(),
  stop: () => window.electron.cocoon.stop(),
  walletExists: () => window.electron.cocoon.walletExists(),
  walletCreate: () => window.electron.cocoon.walletCreate(),
  walletInfo: () => window.electron.cocoon.walletInfo(),
  walletExportMnemonic: () => window.electron.cocoon.walletExportMnemonic(),
  walletDelete: () => window.electron.cocoon.walletDelete(),
  walletMarkSetupComplete: () => window.electron.cocoon.walletMarkSetupComplete(),
  getOwnerBalance: () => window.electron.cocoon.getOwnerBalance(),
  getCocoonWalletBalance: () => window.electron.cocoon.getCocoonWalletBalance(),
  fundCocoon: (amount: string | 'max') => window.electron.cocoon.fundCocoon(amount),
  stakeInfo: () => window.electron.cocoon.stakeInfo(),
  unstake: () => window.electron.cocoon.unstake(),
  cashout: () => window.electron.cocoon.cashout(),
  flowStake: () => window.electron.cocoon.flowStake(),
  flowUnstake: () => window.electron.cocoon.flowUnstake(),
  flowPending: () => window.electron.cocoon.flowPending(),
  archiveList: () => window.electron.cocoon.archiveList(),
  archiveExportMnemonic: (archivedAt: number) => window.electron.cocoon.archiveExportMnemonic(archivedAt),
  recoveryEnqueue: (params: { archivedAt: number; clientSCAddress: string }) =>
    window.electron.cocoon.recoveryEnqueue(params),
  recoveryList: () => window.electron.cocoon.recoveryList(),
  recoveryRemove: (archivedAt: number) => window.electron.cocoon.recoveryRemove(archivedAt),
  recoveryAll: () => window.electron.cocoon.recoveryAll(),
  onWithdraw: (listener: (event: WithdrawDriverEvent) => void) => window.electron.on('cocoon:withdraw:event', listener),
  onRecovery: (listener: (event: RecoveryDriverEvent) => void) => window.electron.on('cocoon:recovery:event', listener),
  onStateChanged: (listener: (state: CocoonState) => void) => window.electron.on('cocoon:state-changed', listener),
}
