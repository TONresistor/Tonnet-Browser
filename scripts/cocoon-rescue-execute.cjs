/**
 * One-shot Cocoon stake recovery script.
 *
 * Usage:
 *   npx electron --no-sandbox scripts/cocoon-rescue-execute.cjs status
 *   npx electron --no-sandbox scripts/cocoon-rescue-execute.cjs phase1
 *   npx electron --no-sandbox scripts/cocoon-rescue-execute.cjs phase2
 *
 * Reads cocoon-wallet.dat via Electron safeStorage. Builds the unstake
 * sequence external messages. Broadcasts via toncenter v3 HTTP.
 *
 * Phase 1 = deploy cocoon node wallet (if uninit) + send 0xfafa6cc1 to client SC
 * Phase 2 = same opcode again after on-chain unlock_ts elapsed AND proxy closed
 */

process.stdout.write('boot\n')
const fs = require('fs')
const path = require('path')
const { app, safeStorage } = require('electron')
process.stdout.write('electron loaded\n')
const tonCore = require(path.resolve(__dirname, '..', 'node_modules', '@ton', 'core'))
const { Address, Cell, beginCell, storeMessage, SendMode, contractAddress } = tonCore
process.stdout.write('ton/core loaded\n')
const { keyPairFromSeed, sign } = require(path.resolve(__dirname, '..', 'node_modules', '@ton', 'crypto'))
process.stdout.write('ton/crypto loaded\n')

// --- configuration ---
const userData = process.env.TON_BROWSER_USER_DATA || '/home/anon/.config/ton-browser'
app.setName('TON Browser')
app.setPath('userData', userData)

const TONCENTER = 'https://toncenter.com/api/v3'

// Same constants as src/main/cocoon/current-withdraw.ts
const REFUND_GAS_NANO = 200_000_000n // 0.2 TON
const VALID_UNTIL_SECONDS = 60

// Cocoon wallet code (vendored from contract repo)
const cocoonWalletCodeJson = require(path.join(__dirname, '..', 'resources', 'cocoon', 'cocoon-wallet.code.json'))
const COCOON_WALLET_CODE = Cell.fromBoc(Buffer.from(cocoonWalletCodeJson.hex, 'hex'))[0]

// --- helpers ---

function decryptJson(fileName) {
  const filePath = path.join(userData, fileName)
  if (!fs.existsSync(filePath)) return null
  const buf = fs.readFileSync(filePath)
  if (!buf.subarray(0, 4).equals(Buffer.from('SENC'))) {
    throw new Error(`${fileName}: missing SENC marker`)
  }
  return JSON.parse(safeStorage.decryptString(buf.subarray(4)))
}

function buildCocoonWalletInit(ownerAddress, nodePublicKeyHex) {
  const data = beginCell()
    .storeInt(0, 32) // seqno
    .storeInt(0, 32) // subwallet
    .storeBuffer(Buffer.from(nodePublicKeyHex, 'hex'), 32)
    .storeUint(0, 32) // status
    .storeAddress(Address.parse(ownerAddress))
    .endCell()
  return { code: COCOON_WALLET_CODE, data }
}

function deriveCocoonWalletAddress(ownerAddress, nodePublicKeyHex) {
  const init = buildCocoonWalletInit(ownerAddress, nodePublicKeyHex)
  return contractAddress(0, init)
}

function buildOutboundMessageCell({ to, value, body, mode, bounce }) {
  const builder = beginCell()
    .storeUint(bounce ? 0x18 : 0x10, 6)
    .storeAddress(to)
    .storeCoins(value)
    .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1)
  if (body) {
    builder.storeUint(1, 1).storeRef(body)
  } else {
    builder.storeUint(0, 1)
  }
  return builder.endCell()
}

function createCocoonWalletExternalBody(messages, secretKey, { seqno, validUntil, subwalletId = 0 }) {
  let body = beginCell()
    .storeUint(subwalletId, 32)
    .storeUint(validUntil, 32)
    .storeUint(seqno, 32)
  for (const msg of messages) {
    const mode = msg.mode ?? SendMode.PAY_GAS_SEPARATELY
    const msgCell = buildOutboundMessageCell({
      to: msg.to,
      value: msg.value,
      body: msg.body,
      mode,
      bounce: msg.bounce ?? true,
    })
    body = body.storeUint(mode, 8).storeRef(msgCell)
  }
  const bodyCell = body.endCell()
  const signature = sign(bodyCell.hash(), secretKey)
  return beginCell()
    .storeBuffer(signature)
    .storeSlice(bodyCell.beginParse())
    .endCell()
}

// --- on-chain queries ---

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function tcGet(url) {
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`${TONCENTER}${url}`)
    if (res.status === 429) { await sleep(2500); continue }
    if (!res.ok) throw new Error(`toncenter GET ${url} -> ${res.status}`)
    await sleep(1100) // throttle
    return res.json()
  }
  throw new Error(`toncenter GET ${url}: rate limited after retries`)
}

async function tcPost(url, body) {
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`${TONCENTER}${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.status === 429) { await sleep(2500); continue }
    const data = await res.json()
    if (!res.ok) throw new Error(`toncenter POST ${url} -> ${res.status}: ${JSON.stringify(data)}`)
    await sleep(1100)
    return data
  }
  throw new Error(`toncenter POST ${url}: rate limited after retries`)
}

async function getAccount(address) {
  return tcGet(`/account?address=${encodeURIComponent(address)}`)
}

async function getClientData(clientSCAddress) {
  const r = await tcPost('/runGetMethod', {
    address: clientSCAddress,
    method: 'get_cocoon_client_data',
    stack: [],
  })
  if (r.exit_code !== 0) {
    throw new Error(`get_cocoon_client_data exit_code=${r.exit_code}`)
  }
  // [owner, proxy, proxy_pk, state, balance, stake, tokens_used, unlock_ts, secret_hash]
  return {
    state: parseInt(r.stack[3].value, 16),
    balance: BigInt(r.stack[4].value),
    stake: BigInt(r.stack[5].value),
    tokensUsed: BigInt(r.stack[6].value),
    unlockTs: parseInt(r.stack[7].value, 16),
  }
}

async function getProxyData(proxySCAddress) {
  const r = await tcPost('/runGetMethod', {
    address: proxySCAddress,
    method: 'get_cocoon_proxy_data',
    stack: [],
  })
  if (r.exit_code !== 0) {
    throw new Error(`get_cocoon_proxy_data exit_code=${r.exit_code}`)
  }
  return {
    state: parseInt(r.stack[3].value, 16),
    balance: BigInt(r.stack[4].value),
    stake: BigInt(r.stack[5].value),
    unlockTs: parseInt(r.stack[6].value, 16),
    minClientStake: BigInt(r.stack[10].value),
  }
}

async function broadcastBoc(bocBase64) {
  return tcPost('/message', { boc: bocBase64 })
}

// --- actions ---

async function actionStatus() {
  const stake = JSON.parse(fs.readFileSync(path.join(userData, 'cocoon-stake.json'), 'utf8'))
  const wallet = decryptJson('cocoon-wallet.dat')
  console.log('=== LOCAL ===')
  console.log(`  ownerAddress:     ${wallet.ownerAddress}`)
  console.log(`  cocoonNodeAddr:   ${wallet.nodeAddress}`)
  console.log(`  nodePublicKeyHex: ${wallet.nodePublicKeyHex}`)
  console.log(`  clientSCAddress:  ${stake.clientSCAddress}`)
  console.log(`  proxySCAddress:   ${stake.proxySCAddress}`)

  console.log('\n=== ON-CHAIN ===')
  const ownerAcct = await getAccount(wallet.ownerAddress)
  console.log(`  Owner wallet:     status=${ownerAcct.status}  balance=${(BigInt(ownerAcct.balance) / 1_000_000n).toString()} mTON`)

  const nodeAcct = await getAccount(wallet.nodeAddress)
  console.log(`  Cocoon node:      status=${nodeAcct.status}  balance=${(BigInt(nodeAcct.balance) / 1_000_000n).toString()} mTON  hasCode=${Boolean(nodeAcct.code)}`)

  const client = await getClientData(stake.clientSCAddress)
  const stateNames = ['NORMAL', 'CLOSING', 'CLOSED']
  console.log(`  Client SC:        state=${client.state}(${stateNames[client.state]})  balance=${client.balance / 1_000_000n} mTON  stake=${client.stake / 1_000_000n} mTON  unlockTs=${client.unlockTs}`)

  const proxy = await getProxyData(stake.proxySCAddress)
  console.log(`  Proxy SC:         state=${proxy.state}(${stateNames[proxy.state]})  balance=${proxy.balance / 1_000_000n} mTON  stake=${proxy.stake / 1_000_000n} mTON  minClientStake=${proxy.minClientStake / 1_000_000n} mTON`)

  return { wallet, stake, client, proxy, nodeAcct }
}

async function actionPhase1() {
  const { wallet, stake, client, nodeAcct } = await actionStatus()

  console.log('\n=== PHASE 1 PRE-CHECK ===')
  if (client.state !== 0) {
    console.log(`  Client state=${client.state} (expected 0=normal). Cannot send phase 1.`)
    if (client.state === 1) {
      console.log(`  Already closing. Run phase2 once unlock_ts (${client.unlockTs}) elapsed AND proxy state == 2.`)
    }
    return
  }
  // Cocoon wallet FC requires my_balance >= 2 TON for external acceptance.
  // Need extra ~0.25 TON for deploy gas + inner message (REFUND_GAS_NANO=0.2).
  const NODE_MIN_NANO = 2_250_000_000n
  if (BigInt(nodeAcct.balance) < NODE_MIN_NANO) {
    console.log(`  Cocoon node balance ${nodeAcct.balance} < ${NODE_MIN_NANO} (2.25 TON). Top up first.`)
    return
  }
  console.log(`  PASS: client state=normal, node balance ${nodeAcct.balance} >= 2.25 TON`)

  const derivedAddr = deriveCocoonWalletAddress(wallet.ownerAddress, wallet.nodePublicKeyHex).toString({ bounceable: true })
  if (derivedAddr !== wallet.nodeAddress) {
    throw new Error(`Cocoon wallet address mismatch: derived=${derivedAddr} stored=${wallet.nodeAddress}`)
  }
  console.log('  PASS: derived cocoon node address matches stored')

  const nodeSecretRaw = Buffer.from(wallet.nodeSecretBase64, 'base64')
  if (nodeSecretRaw.length !== 32) {
    throw new Error(`node secret length ${nodeSecretRaw.length} != 32`)
  }
  const keyPair = keyPairFromSeed(nodeSecretRaw)

  // Inner body: 0xfafa6cc1 owner_client_request_refund
  const refundBody = beginCell()
    .storeUint(0xfafa6cc1, 32)
    .storeUint(0, 64)
    .storeAddress(Address.parse(wallet.ownerAddress)) // send_excesses_to
    .endCell()

  const cocoonAddr = Address.parse(wallet.nodeAddress)
  const clientAddr = Address.parse(stake.clientSCAddress)

  const isUninit = nodeAcct.status === 'uninit'
  let seqno = 0
  if (!isUninit) {
    const r = await tcPost('/runGetMethod', { address: wallet.nodeAddress, method: 'seqno', stack: [] })
    seqno = parseInt(r.stack[0].value, 16)
  }
  console.log(`  Cocoon node seqno=${seqno}, uninit=${isUninit}`)

  const validUntil = Math.floor(Date.now() / 1000) + VALID_UNTIL_SECONDS

  const signedBody = createCocoonWalletExternalBody(
    [
      {
        to: clientAddr,
        value: REFUND_GAS_NANO,
        body: refundBody,
        bounce: true,
        mode: SendMode.PAY_GAS_SEPARATELY,
      },
    ],
    keyPair.secretKey,
    { seqno, validUntil, subwalletId: 0 },
  )

  const init = isUninit
    ? buildCocoonWalletInit(wallet.ownerAddress, wallet.nodePublicKeyHex)
    : undefined

  const extMsg = beginCell()
    .store(
      storeMessage({
        info: { type: 'external-in', dest: cocoonAddr, importFee: 0n },
        init,
        body: signedBody,
      }),
    )
    .endCell()

  const boc = extMsg.toBoc().toString('base64')
  console.log(`\n  Built external message (${extMsg.toBoc().length} bytes), valid_until=${validUntil}`)
  console.log(`  BoC base64: ${boc.slice(0, 80)}...`)
  console.log(`  Hash: ${extMsg.hash().toString('hex')}`)

  console.log('\n=== BROADCASTING ===')
  const result = await broadcastBoc(boc)
  console.log('  Broadcast response:', JSON.stringify(result))
  console.log('\nWait ~30s then run: scripts/cocoon-rescue-execute.cjs status')
  console.log('Expected progression:')
  console.log('  1. Cocoon node wallet: uninit -> active (deploy via StateInit)')
  console.log('  2. Cocoon node sends internal 0xfafa6cc1 to client SC')
  console.log('  3. Client SC: state 0 -> 1 (closing), unlock_ts set')
  console.log('  4. Off-chain: TEE detects closing, signs ext_proxy_close_*, proxy goes 0 -> 1 -> 2')
  console.log('  5. Once both client.unlock_ts elapsed AND proxy.state==2: run phase2')
}

async function actionPhase2() {
  const { wallet, stake, client, proxy, nodeAcct } = await actionStatus()

  console.log('\n=== PHASE 2 PRE-CHECK ===')
  const now = Math.floor(Date.now() / 1000)

  if (client.state !== 1) {
    console.log(`  Client state=${client.state} (expected 1=closing). Cannot send phase 2.`)
    return
  }
  if (client.unlockTs >= now) {
    console.log(`  Client unlock_ts=${client.unlockTs} > now=${now}. Wait ${client.unlockTs - now}s.`)
    return
  }
  if (proxy.state !== 2) {
    console.log(`  Proxy state=${proxy.state} (expected 2=closed). TEE has not closed proxy yet — without proxy.state=closed, refund_force will be capped at proxy.stake=${proxy.stake}. Aborting.`)
    return
  }
  console.log('  PASS: client closing, unlock_ts elapsed, proxy closed')

  if (nodeAcct.status === 'uninit') {
    console.log('  ERROR: cocoon node wallet still uninit. Phase 1 did not deploy.')
    return
  }

  const nodeSecretRaw = Buffer.from(wallet.nodeSecretBase64, 'base64')
  const keyPair = keyPairFromSeed(nodeSecretRaw)

  const refundBody = beginCell()
    .storeUint(0xfafa6cc1, 32)
    .storeUint(0, 64)
    .storeAddress(Address.parse(wallet.ownerAddress))
    .endCell()

  const cocoonAddr = Address.parse(wallet.nodeAddress)
  const clientAddr = Address.parse(stake.clientSCAddress)

  const seqnoR = await tcPost('/runGetMethod', { address: wallet.nodeAddress, method: 'seqno', stack: [] })
  const seqno = parseInt(seqnoR.stack[0].value, 16)
  console.log(`  Cocoon node seqno=${seqno}`)

  const validUntil = Math.floor(Date.now() / 1000) + VALID_UNTIL_SECONDS

  const signedBody = createCocoonWalletExternalBody(
    [
      {
        to: clientAddr,
        value: REFUND_GAS_NANO,
        body: refundBody,
        bounce: true,
        mode: SendMode.PAY_GAS_SEPARATELY,
      },
    ],
    keyPair.secretKey,
    { seqno, validUntil, subwalletId: 0 },
  )

  const extMsg = beginCell()
    .store(
      storeMessage({
        info: { type: 'external-in', dest: cocoonAddr, importFee: 0n },
        body: signedBody,
      }),
    )
    .endCell()

  const boc = extMsg.toBoc().toString('base64')
  console.log(`\n  Hash: ${extMsg.hash().toString('hex')}`)
  console.log('\n=== BROADCASTING PHASE 2 ===')
  const result = await broadcastBoc(boc)
  console.log('  Broadcast response:', JSON.stringify(result))
}

// --- entry point ---

async function actionDrainOwnerToMain(destAddress) {
  if (!destAddress) {
    throw new Error('drain-to-main requires destination address as 2nd arg')
  }
  const wallet = decryptJson('cocoon-wallet.dat')
  if (!wallet.ownerMnemonic || wallet.ownerMnemonic.length !== 24) {
    throw new Error('Owner mnemonic not found / invalid')
  }
  const ownerAcct = await getAccount(wallet.ownerAddress)
  console.log(`Cocoon owner V4R2 (${wallet.ownerAddress}):`)
  console.log(`  status=${ownerAcct.status} balance=${BigInt(ownerAcct.balance) / 1_000_000n} mTON`)
  if (BigInt(ownerAcct.balance) < 100_000_000n) {
    console.log('  Balance < 0.1 TON — skipped.')
    return
  }

  const { mnemonicToPrivateKey } = require(path.resolve(__dirname, '..', 'node_modules', '@ton', 'crypto'))
  const { WalletContractV4, internal } = require(path.resolve(__dirname, '..', 'node_modules', '@ton', 'ton'))

  const keys = await mnemonicToPrivateKey(wallet.ownerMnemonic)
  const v4 = WalletContractV4.create({ workchain: 0, publicKey: keys.publicKey })
  if (v4.address.toString({ bounceable: true }) !== wallet.ownerAddress) {
    throw new Error(`Derived V4R2 ${v4.address} != stored ${wallet.ownerAddress}`)
  }
  console.log(`  V4R2 address derived OK`)

  let seqno = 0
  if (ownerAcct.status === 'active') {
    const r = await tcPost('/runGetMethod', { address: wallet.ownerAddress, method: 'seqno', stack: [] })
    seqno = parseInt(r.stack[0].value, 16)
  }
  console.log(`  V4R2 seqno=${seqno}, uninit=${ownerAcct.status !== 'active'}`)

  const dest = Address.parse(destAddress)
  const drainMode = 128 + 32
  const validUntil = Math.floor(Date.now() / 1000) + VALID_UNTIL_SECONDS

  const transfer = v4.createTransfer({
    seqno,
    secretKey: keys.secretKey,
    messages: [internal({ to: dest, value: 0n, bounce: false })],
    sendMode: drainMode,
    timeout: validUntil,
  })

  const extMsg = beginCell()
    .store(
      storeMessage({
        info: { type: 'external-in', dest: v4.address, importFee: 0n },
        init: seqno === 0 ? v4.init : undefined,
        body: transfer,
      }),
    )
    .endCell()

  const boc = extMsg.toBoc().toString('base64')
  console.log(`  Hash: ${extMsg.hash().toString('hex')}`)
  console.log(`  Drain target: ${destAddress}`)
  console.log('\n=== BROADCASTING DRAIN OWNER → MAIN ===')
  const result = await broadcastBoc(boc)
  console.log('  Broadcast response:', JSON.stringify(result))
  console.log('\nWatch destination balance increase.')
}

async function actionDrain() {
  const wallet = decryptJson('cocoon-wallet.dat')
  const nodeAcct = await getAccount(wallet.nodeAddress)
  console.log(`Cocoon node: status=${nodeAcct.status} balance=${BigInt(nodeAcct.balance) / 1_000_000n} mTON`)
  if (nodeAcct.status !== 'active') {
    console.log('  Cocoon node not active. Cannot drain (need code deployed).')
    return
  }
  if (BigInt(nodeAcct.balance) < 100_000_000n) {
    console.log('  Balance < 0.1 TON — nothing to drain meaningfully.')
    return
  }

  const seqnoR = await tcPost('/runGetMethod', { address: wallet.nodeAddress, method: 'seqno', stack: [] })
  const seqno = parseInt(seqnoR.stack[0].value, 16)
  console.log(`  Cocoon node seqno=${seqno}`)

  const nodeSecretRaw = Buffer.from(wallet.nodeSecretBase64, 'base64')
  const keyPair = keyPairFromSeed(nodeSecretRaw)

  const cocoonAddr = Address.parse(wallet.nodeAddress)
  const ownerAddr = Address.parse(wallet.ownerAddress)

  const validUntil = Math.floor(Date.now() / 1000) + VALID_UNTIL_SECONDS

  // CARRY_ALL_REMAINING_BALANCE (128) + DESTROY_ACCOUNT_IF_ZERO (32) = 160
  const drainMode = 128 + 32

  const signedBody = createCocoonWalletExternalBody(
    [
      {
        to: ownerAddr,
        value: 0n, // ignored when CARRY_ALL is set
        body: undefined,
        bounce: false,
        mode: drainMode,
      },
    ],
    keyPair.secretKey,
    { seqno, validUntil, subwalletId: 0 },
  )

  const extMsg = beginCell()
    .store(
      storeMessage({
        info: { type: 'external-in', dest: cocoonAddr, importFee: 0n },
        body: signedBody,
      }),
    )
    .endCell()

  const boc = extMsg.toBoc().toString('base64')
  console.log(`  Hash: ${extMsg.hash().toString('hex')}`)
  console.log(`  Drain target: ${wallet.ownerAddress}`)
  console.log('\n=== BROADCASTING DRAIN ===')
  const result = await broadcastBoc(boc)
  console.log('  Broadcast response:', JSON.stringify(result))
}

app.whenReady().then(async () => {
  console.log('argv=', JSON.stringify(process.argv))
  const args = process.argv.filter((a, i) => i > 0 && !a.startsWith('-') && !a.endsWith('.cjs'))
  const action = args[0] || 'status'
  console.log('action=', action)
  try {
    if (action === 'status') {
      await actionStatus()
    } else if (action === 'phase1') {
      await actionPhase1()
    } else if (action === 'phase2') {
      await actionPhase2()
    } else if (action === 'drain') {
      await actionDrain()
    } else if (action === 'drain-to-main') {
      await actionDrainOwnerToMain(args[1])
    } else {
      console.log('Usage: status | phase1 | phase2 | drain | drain-to-main <destAddress>')
      process.exitCode = 1
    }
  } catch (err) {
    console.error('FATAL:', err?.stack || err?.message || String(err))
    process.exitCode = 1
  } finally {
    app.quit()
  }
})
