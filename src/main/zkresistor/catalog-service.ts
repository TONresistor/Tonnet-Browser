import { Cell } from '@ton/core'
import { Factory, TonPool, type AccountState } from '@tonresistor/zkresistor-sdk'
import type { ZkResistorCatalog, ZkResistorPool } from '../../shared/ipc-contract/zkresistor'
import type { ZkResistorBridgePort } from '../ports/zkresistor-bridge'
import { ZkResistorChainClient } from './chain-client'

const PROTOCOL = {
  factoryAddress: 'EQB8W1W276GWiQpK88Sx46K20rsMrCKIezOpwFGJ4dhjWz58',
  codeHashes: {
    factory: 'c2c1ffadb3c46ebba1fc9b184a384590b057a8a3d19eb9edd3dfc86ed5983f36',
    tonPool: 'fde119db0060a01c0a00adc307ec98a2bf5b734ca7ef45e886c9ca2cce642aa3',
  },
} as const

export class ZkResistorCatalogService {
  private readonly client: ZkResistorChainClient

  constructor(bridge: ZkResistorBridgePort) {
    this.client = new ZkResistorChainClient(bridge)
  }

  async load(): Promise<ZkResistorCatalog> {
    const factory = await this.client.getAccountState(PROTOCOL.factoryAddress)
    assertContract(factory, PROTOCOL.codeHashes.factory, 'Factory')
    const storage = Factory.parseFactoryStorage(factory.data ?? '')
    if (storage.tonPoolCodeHash !== PROTOCOL.codeHashes.tonPool) {
      throw new Error('Factory TonPool bytecode does not match the pinned protocol')
    }

    const pools = await Promise.all(
      storage.tonPools.map(async (poolAddress): Promise<ZkResistorPool> => {
        const account = await this.client.getAccountState(poolAddress)
        assertContract(account, PROTOCOL.codeHashes.tonPool, 'TonPool')
        const state = await TonPool.readState(this.client, poolAddress)
        const target = TonPool.syncTargetFromState(poolAddress, state)
        return poolView({
          address: poolAddress,
          denomination: state.denomination,
          nextIndex: state.nextIndex,
          withdrawalCount: target.withdrawalCount,
        })
      })
    )

    return {
      factoryAddress: PROTOCOL.factoryAddress,
      sdkVersion: '2.0.1',
      loadedAt: new Date().toISOString(),
      pools: pools.sort(comparePools),
    }
  }
}

function assertContract(account: AccountState, expectedHash: string, label: string): void {
  if (account.status !== 'active' || !account.code || !account.data) throw new Error(`${label} is not active`)
  if (Cell.fromBase64(account.code).hash().toString('hex') !== expectedHash) {
    throw new Error(`${label} bytecode does not match the pinned protocol`)
  }
}

function poolView(input: {
  address: string
  denomination: bigint
  nextIndex: number
  withdrawalCount: number
}): ZkResistorPool {
  const shieldedDeposits = Math.max(0, input.nextIndex - input.withdrawalCount)
  return {
    id: input.address,
    address: input.address,
    kind: 'ton',
    symbol: 'GRAM',
    name: 'GRAM',
    denomination: input.denomination.toString(),
    decimals: 9,
    nextIndex: input.nextIndex,
    withdrawalCount: input.withdrawalCount,
    shieldedDeposits,
    shieldedAmount: (input.denomination * BigInt(shieldedDeposits)).toString(),
    capacity: 1_048_576,
  }
}

function comparePools(left: ZkResistorPool, right: ZkResistorPool): number {
  const denomination = BigInt(left.denomination) - BigInt(right.denomination)
  return denomination < 0n ? -1 : denomination > 0n ? 1 : 0
}
