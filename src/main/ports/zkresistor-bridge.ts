import type { AccountInformationResult } from './ton-bridge'

export interface ZkResistorBridgePort {
  getAccountInformation(address: string): Promise<AccountInformationResult>
  runMethod(address: string, method: string, params?: unknown[]): Promise<unknown>
}
