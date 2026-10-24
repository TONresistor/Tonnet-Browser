export { withWalletActivity } from './activity'
export { useWalletPageOpen } from './useWalletPageOpen'

import { useWalletStore } from './store'

export const useWalletManagement = () => useWalletStore()
