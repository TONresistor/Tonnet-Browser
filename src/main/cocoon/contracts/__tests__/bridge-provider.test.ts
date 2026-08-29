import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Address, beginCell, Cell, SendMode } from '@ton/core'
import { BridgeProvider, bridgeItemToTupleItem, bridgeStackToTupleReader, openBridgeContract } from '../bridge-provider'
import type { WsBridgeClient } from '../../../ton-bridge/ws-bridge-client'
import { CocoonWallet } from '../wrappers/CocoonWallet'

// ---------------------------------------------------------------------------
// Mock WsBridgeClient
// ---------------------------------------------------------------------------

function makeBridgeMock(): WsBridgeClient {
  return {
    getBalance: vi.fn(),
    runMethod: vi.fn(),
    broadcast: vi.fn(),
    getTransactions: vi.fn(),
    getSeqno: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn(),
    sendAndWatch: vi.fn(),
    resolveDomain: vi.fn(),
    subscribeAccountState: vi.fn(),
    subscribeTransactions: vi.fn(),
    unsubscribe: vi.fn(),
  } as unknown as WsBridgeClient
}

const TEST_ADDR = Address.parse('EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N')

// ---------------------------------------------------------------------------
// bridgeItemToTupleItem — real bridge format: string | null
// ---------------------------------------------------------------------------

describe('bridgeItemToTupleItem', () => {
  it('converts null to TupleItemNull', () => {
    expect(bridgeItemToTupleItem(null)).toEqual({ type: 'null' })
  })

  it('converts decimal string to TupleItemInt', () => {
    const item = bridgeItemToTupleItem('12345')
    expect(item.type).toBe('int')
    if (item.type === 'int') expect(item.value).toBe(12345n)
  })

  it('converts negative decimal string to TupleItemInt', () => {
    const item = bridgeItemToTupleItem('-99')
    expect(item.type).toBe('int')
    if (item.type === 'int') expect(item.value).toBe(-99n)
  })

  it('converts zero string to TupleItemInt', () => {
    const item = bridgeItemToTupleItem('0')
    expect(item.type).toBe('int')
    if (item.type === 'int') expect(item.value).toBe(0n)
  })

  it('converts base64 BOC string to TupleItemCell', () => {
    const cell = beginCell().storeUint(0xdeadbeef, 32).endCell()
    const b64 = cell.toBoc().toString('base64')
    const item = bridgeItemToTupleItem(b64)
    expect(item.type).toBe('cell')
    if (item.type === 'cell') {
      expect(item.cell.toBoc().toString('base64')).toBe(b64)
    }
  })
})

// ---------------------------------------------------------------------------
// bridgeStackToTupleReader — real bridge format
// ---------------------------------------------------------------------------

describe('bridgeStackToTupleReader', () => {
  it('handles empty stack', () => {
    const reader = bridgeStackToTupleReader([])
    expect(reader.remaining).toBe(0)
  })

  it('converts decimal string "123" → readBigNumber returns 123n', () => {
    const reader = bridgeStackToTupleReader(['123'])
    expect(reader.readBigNumber()).toBe(123n)
  })

  it('converts decimal string → readNumber returns correct JS number', () => {
    const reader = bridgeStackToTupleReader(['42'])
    expect(reader.readNumber()).toBe(42)
  })

  it('converts base64 BOC of a known cell → readCell returns matching cell', () => {
    const cell = beginCell().storeUint(7, 8).endCell()
    const b64 = cell.toBoc().toString('base64')
    const reader = bridgeStackToTupleReader([b64])
    const readCell = reader.readCell()
    expect(readCell.toBoc().toString('base64')).toBe(b64)
  })

  it('converts null → readNumberOpt returns null', () => {
    const reader = bridgeStackToTupleReader([null])
    expect(reader.readNumberOpt()).toBeNull()
  })

  it('handles mixed stack: int then cell', () => {
    const cell = beginCell().storeUint(1, 8).endCell()
    const b64 = cell.toBoc().toString('base64')
    const reader = bridgeStackToTupleReader(['999', b64])
    expect(reader.readNumber()).toBe(999)
    expect(reader.readCell().toBoc().toString('base64')).toBe(b64)
  })

  it('handles multiple integers', () => {
    const reader = bridgeStackToTupleReader(['100', '200'])
    expect(reader.readBigNumber()).toBe(100n)
    expect(reader.readBigNumber()).toBe(200n)
  })

  // NOTE: nested tuples are NOT tested because the bridge serialises them
  // via fmt.Sprintf("%v", v) (the default branch in serializeStack), which
  // produces an unstructured Go-syntax string rather than a proper JSON
  // tuple. The bridge protocol does not support nested tuples in
  // get-method results; callers should never encounter them in practice.
})

// ---------------------------------------------------------------------------
// BridgeProvider.getState
// ---------------------------------------------------------------------------

describe('BridgeProvider.getState', () => {
  let bridge: WsBridgeClient
  let provider: BridgeProvider

  beforeEach(() => {
    bridge = makeBridgeMock()
    provider = new BridgeProvider(bridge, TEST_ADDR)
  })

  it('returns balance as bigint from bridge.getBalance', async () => {
    vi.mocked(bridge.getBalance).mockResolvedValue('5000000000')
    const state = await provider.getState()
    expect(state.balance).toBe(5000000000n)
    expect(bridge.getBalance).toHaveBeenCalledWith(TEST_ADDR.toString())
  })

  it('includes extracurrency null, last null, state active', async () => {
    vi.mocked(bridge.getBalance).mockResolvedValue('0')
    const state = await provider.getState()
    expect(state.extracurrency).toBeNull()
    expect(state.last).toBeNull()
    expect(state.state.type).toBe('active')
  })
})

// ---------------------------------------------------------------------------
// BridgeProvider.get — uses real bridge format
// ---------------------------------------------------------------------------

describe('BridgeProvider.get', () => {
  let bridge: WsBridgeClient
  let provider: BridgeProvider

  beforeEach(() => {
    bridge = makeBridgeMock()
    provider = new BridgeProvider(bridge, TEST_ADDR)
  })

  it('calls bridge.runMethod with correct address and method name', async () => {
    vi.mocked(bridge.runMethod).mockResolvedValue({ stack: ['3'] })
    const result = await provider.get('seqno', [])
    expect(bridge.runMethod).toHaveBeenCalledWith(TEST_ADDR.toString(), 'seqno')
    expect(result.stack.readNumber()).toBe(3)
  })

  it('returns TupleReader with parsed stack — real format', async () => {
    vi.mocked(bridge.runMethod).mockResolvedValue({ stack: ['100', '200'] })
    const result = await provider.get('some_method', [])
    expect(result.stack.readBigNumber()).toBe(100n)
    expect(result.stack.readBigNumber()).toBe(200n)
  })

  it('handles null stack from bridge', async () => {
    vi.mocked(bridge.runMethod).mockResolvedValue(null)
    const result = await provider.get('get_something', [])
    expect(result.stack.remaining).toBe(0)
  })

  it('handles empty stack array', async () => {
    vi.mocked(bridge.runMethod).mockResolvedValue({ stack: [] })
    const result = await provider.get('get_something', [])
    expect(result.stack.remaining).toBe(0)
  })

  it('throws on numeric method id', async () => {
    await expect(provider.get(0x1234, [])).rejects.toThrow('numeric method ids are not supported')
  })

  it('throws when args are passed', async () => {
    await expect(provider.get('some_method', [{ type: 'int', value: 1n }])).rejects.toThrow(
      'typed TupleItem args are not supported'
    )
  })

  it('throws when exit_code indicates failure', async () => {
    vi.mocked(bridge.runMethod).mockResolvedValue({ stack: [], exit_code: 5 })
    await expect(provider.get('bad_method', [])).rejects.toThrow('exit_code=5')
  })

  it('does not throw for exit_code 0', async () => {
    vi.mocked(bridge.runMethod).mockResolvedValue({ stack: ['1'], exit_code: 0 })
    const result = await provider.get('ok_method', [])
    expect(result.stack.readNumber()).toBe(1)
  })

  it('does not throw for exit_code 1', async () => {
    vi.mocked(bridge.runMethod).mockResolvedValue({ stack: ['2'], exit_code: 1 })
    const result = await provider.get('ok_method', [])
    expect(result.stack.readNumber()).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// BridgeProvider.external
// ---------------------------------------------------------------------------

describe('BridgeProvider.external', () => {
  let bridge: WsBridgeClient
  let provider: BridgeProvider

  beforeEach(() => {
    bridge = makeBridgeMock()
    provider = new BridgeProvider(bridge, TEST_ADDR)
    vi.mocked(bridge.broadcast).mockResolvedValue(undefined)
  })

  it('calls bridge.broadcast with the cell BoC buffer', async () => {
    const cell = beginCell().storeUint(0xdeadbeef, 32).endCell()
    await provider.external(cell)
    expect(bridge.broadcast).toHaveBeenCalledWith(cell.toBoc())
  })
})

// ---------------------------------------------------------------------------
// BridgeProvider.internal
// ---------------------------------------------------------------------------

describe('BridgeProvider.internal', () => {
  let bridge: WsBridgeClient
  let provider: BridgeProvider

  beforeEach(() => {
    bridge = makeBridgeMock()
    provider = new BridgeProvider(bridge, TEST_ADDR)
  })

  it('calls via.send with correct to, value, bounce defaults', async () => {
    const sender = { send: vi.fn().mockResolvedValue(undefined), address: TEST_ADDR }
    await provider.internal(sender, { value: 1000000000n })
    expect(sender.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: TEST_ADDR,
        value: 1000000000n,
        bounce: true,
        sendMode: SendMode.PAY_GAS_SEPARATELY,
      })
    )
  })

  it('converts string value to bigint', async () => {
    const sender = { send: vi.fn().mockResolvedValue(undefined), address: TEST_ADDR }
    await provider.internal(sender, { value: '2000000000' })
    expect(sender.send).toHaveBeenCalledWith(expect.objectContaining({ value: 2000000000n }))
  })

  it('passes explicit sendMode and bounce', async () => {
    const sender = { send: vi.fn().mockResolvedValue(undefined), address: TEST_ADDR }
    await provider.internal(sender, {
      value: 500n,
      bounce: false,
      sendMode: SendMode.IGNORE_ERRORS,
    })
    expect(sender.send).toHaveBeenCalledWith(
      expect.objectContaining({ bounce: false, sendMode: SendMode.IGNORE_ERRORS })
    )
  })

  it('wraps string body in a text cell', async () => {
    const sender = { send: vi.fn().mockResolvedValue(undefined), address: TEST_ADDR }
    await provider.internal(sender, { value: 1n, body: 'hello' })
    const call = vi.mocked(sender.send).mock.calls[0][0]
    expect(call.body).toBeInstanceOf(Cell)
  })

  it('passes Cell body directly', async () => {
    const sender = { send: vi.fn().mockResolvedValue(undefined), address: TEST_ADDR }
    const body = beginCell().storeUint(42, 32).endCell()
    await provider.internal(sender, { value: 1n, body })
    const call = vi.mocked(sender.send).mock.calls[0][0]
    expect(call.body).toBe(body)
  })

  it('includes init when set on provider', async () => {
    const code = beginCell().storeUint(1, 8).endCell()
    const data = beginCell().storeUint(0, 8).endCell()
    const providerWithInit = new BridgeProvider(bridge, TEST_ADDR, { code, data })
    const sender = { send: vi.fn().mockResolvedValue(undefined), address: TEST_ADDR }
    await providerWithInit.internal(sender, { value: 1n })
    const call = vi.mocked(sender.send).mock.calls[0][0]
    expect(call.init).toEqual({ code, data })
  })
})

// ---------------------------------------------------------------------------
// openBridgeContract helper
// ---------------------------------------------------------------------------

describe('openBridgeContract', () => {
  it('returns an OpenedContract with working getter methods — real bridge format', async () => {
    const bridge = makeBridgeMock()
    // Real bridge format: decimal string for integers
    vi.mocked(bridge.runMethod).mockResolvedValue({ stack: ['7'] })

    const wallet = CocoonWallet.createFromAddress(TEST_ADDR)
    const opened = openBridgeContract(bridge, wallet)

    const seqno = await opened.getSeqno()
    expect(seqno).toBe(7)
    expect(bridge.runMethod).toHaveBeenCalledWith(TEST_ADDR.toString(), 'seqno')
  })
})
