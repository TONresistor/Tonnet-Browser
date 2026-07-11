import { beginCell, Cell, type Address } from '@ton/core'
import { sha256_sync } from '@ton/crypto'
import type { SignDataPayloadInput, SignDataResult, TonProofReplyPayload } from '../tonconnect/types'

export interface WalletSigningContext {
  getAddress(): Address | null
  signDigest(digest: Buffer): Promise<Buffer>
  nowSeconds(): number
}

/** TON Connect signing capability, isolated from vault, transport and queries. */
export class WalletSigningService {
  constructor(private readonly context: WalletSigningContext) {}

  async signTonProof(domain: string, payload: string): Promise<TonProofReplyPayload> {
    const address = this.requireAddress()
    const timestamp = this.context.nowSeconds()
    const domainBytes = Buffer.from(domain, 'utf8')
    const workchain = Buffer.alloc(4)
    workchain.writeInt32BE(address.workChain, 0)
    const domainLength = Buffer.alloc(4)
    domainLength.writeUInt32LE(domainBytes.byteLength, 0)
    const time = Buffer.alloc(8)
    time.writeBigUInt64LE(BigInt(timestamp), 0)

    const message = Buffer.concat([
      Buffer.from('ton-proof-item-v2/', 'utf8'),
      workchain,
      address.hash,
      domainLength,
      domainBytes,
      time,
      Buffer.from(payload, 'utf8'),
    ])
    const digest = sha256_sync(
      Buffer.concat([Buffer.from([0xff, 0xff]), Buffer.from('ton-connect', 'utf8'), sha256_sync(message)])
    )
    const signature = await this.context.signDigest(digest)

    return {
      timestamp,
      domain: { lengthBytes: domainBytes.byteLength, value: domain },
      signature: signature.toString('base64'),
      payload,
    }
  }

  async signData(domain: string, payload: SignDataPayloadInput): Promise<SignDataResult> {
    const address = this.requireAddress()
    const timestamp = this.context.nowSeconds()
    const digest =
      payload.type === 'cell'
        ? this.cellDigest(address, domain, timestamp, payload.schema, payload.cell)
        : this.binaryDigest(address, domain, timestamp, payload)
    const signature = await this.context.signDigest(digest)

    return {
      signature: signature.toString('base64'),
      address: address.toRawString(),
      timestamp,
      domain,
      payload,
    }
  }

  private requireAddress(): Address {
    const address = this.context.getAddress()
    if (!address) throw new Error('Wallet not initialized')
    return address
  }

  private cellDigest(address: Address, domain: string, timestamp: number, schema: string, cellBoc: string): Buffer {
    return beginCell()
      .storeUint(0x75569022, 32)
      .storeUint(crc32(schema), 32)
      .storeUint(timestamp, 64)
      .storeAddress(address)
      .storeStringRefTail(domain)
      .storeRef(Cell.fromBase64(cellBoc))
      .endCell()
      .hash()
  }

  private binaryDigest(
    address: Address,
    domain: string,
    timestamp: number,
    payload: Extract<SignDataPayloadInput, { type: 'text' | 'binary' }>
  ): Buffer {
    const workchain = Buffer.alloc(4)
    workchain.writeInt32BE(address.workChain, 0)
    const domainBytes = Buffer.from(domain, 'utf8')
    const domainLength = Buffer.alloc(4)
    domainLength.writeUInt32BE(domainBytes.byteLength, 0)
    const time = Buffer.alloc(8)
    time.writeBigUInt64BE(BigInt(timestamp), 0)
    const prefix = Buffer.from(payload.type === 'text' ? 'txt' : 'bin', 'utf8')
    const data = payload.type === 'text' ? Buffer.from(payload.text, 'utf8') : Buffer.from(payload.bytes, 'base64')
    const dataLength = Buffer.alloc(4)
    dataLength.writeUInt32BE(data.byteLength, 0)
    return sha256_sync(
      Buffer.concat([
        Buffer.from([0xff, 0xff]),
        Buffer.from('ton-connect/sign-data/', 'utf8'),
        workchain,
        address.hash,
        domainLength,
        domainBytes,
        time,
        prefix,
        dataLength,
        data,
      ])
    )
  }
}

function crc32(input: string): number {
  const bytes = Buffer.from(input, 'utf8')
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}
