import type { IpcEventMap } from '../../shared/ipc-events'
import type { IpcEventContract } from '../../shared/ipc-contract/definition'
import { getMainWindow } from '../windows/main'

/** Electron adapter that translates typed application events into renderer IPC. */
export function emitToRenderer<K extends keyof IpcEventMap>(channel: K, ...args: IpcEventMap[K]): void {
  const window = getMainWindow()
  if (window) window.webContents.send(channel, ...args)
}

/** Validate a canonical event contract before it crosses the Electron boundary. */
export function emitContractToRenderer<TArgs extends readonly unknown[]>(
  contract: IpcEventContract<TArgs>,
  ...args: TArgs
): void {
  if (contract.recipient !== 'main-renderer') {
    throw new Error(`Unsupported renderer event recipient for ${contract.channel}: ${contract.recipient}`)
  }
  const validated = contract.payload.parse(args)
  const window = getMainWindow()
  if (window) window.webContents.send(contract.channel, ...validated)
}
