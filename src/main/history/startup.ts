import type { HistoryStats } from '../../shared/types'

type HistoryMode = HistoryStats['mode']

export async function reconcileHistoryModeAtStartup(
  runtimeMode: HistoryMode,
  configuredMode: HistoryMode,
  persist: (mode: HistoryMode) => Promise<unknown>,
  reportFailure: (error: unknown) => void
): Promise<void> {
  if (runtimeMode === configuredMode) return
  try {
    await persist(runtimeMode)
  } catch (error) {
    reportFailure(error)
  }
}
