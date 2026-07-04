import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  randomBytes,
} from 'node:crypto'
import { keyPairFromSeed } from '@ton/crypto'

const DOMAIN = 'tonnet-dm-v1'
const NONCE_SIZE = 12
const TAG_SIZE = 16
const P = (1n << 255n) - 19n

const PKCS8_X25519 = Buffer.from('302e020100300506032b656e04220420', 'hex')
const SPKI_X25519 = Buffer.from('302a300506032b656e032100', 'hex')

function ed25519PrivToX25519(seed: Buffer): Buffer {
  const h = createHash('sha512').update(seed).digest()
  const d = h.subarray(0, 32)
  d[0] &= 248
  d[31] &= 127
  d[31] |= 64
  return d
}

function leToBigInt(b: Buffer): bigint {
  let v = 0n
  for (let i = b.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i])
  return v
}

function bigIntToLe(v: bigint): Buffer {
  const out = Buffer.alloc(32)
  for (let i = 0; i < 32; i++) {
    out[i] = Number(v & 0xffn)
    v >>= 8n
  }
  return out
}

function mod(a: bigint): bigint {
  const r = a % P
  return r < 0n ? r + P : r
}

function modPow(base: bigint, exp: bigint): bigint {
  let r = 1n
  let b = mod(base)
  let e = exp
  while (e > 0n) {
    if (e & 1n) r = mod(r * b)
    b = mod(b * b)
    e >>= 1n
  }
  return r
}

function ed25519PubToX25519(pub: Buffer): Buffer {
  const y = leToBigInt(pub) & ((1n << 255n) - 1n)
  if (y >= P) throw new Error('dm: bad public key')
  const den = mod(1n - y)
  if (den === 0n) throw new Error('dm: bad public key')
  const u = mod((1n + y) * modPow(den, P - 2n))
  return bigIntToLe(u)
}

export function dmSharedKey(mySeed: Buffer, peerPub: Buffer): Buffer {
  if (mySeed.length !== 32 || peerPub.length !== 32) throw new Error('dm: bad key size')
  const priv = createPrivateKey({
    key: Buffer.concat([PKCS8_X25519, ed25519PrivToX25519(mySeed)]),
    format: 'der',
    type: 'pkcs8',
  })
  const pub = createPublicKey({
    key: Buffer.concat([SPKI_X25519, ed25519PubToX25519(peerPub)]),
    format: 'der',
    type: 'spki',
  })
  const secret = diffieHellman({ privateKey: priv, publicKey: pub })
  if (secret.every((b) => b === 0)) throw new Error('dm: bad ecdh result')
  return createHash('sha256').update(DOMAIN).update(secret).digest()
}

function directionAAD(senderPub: Buffer, recipientPub: Buffer): Buffer {
  return Buffer.concat([senderPub, recipientPub])
}

export function sealDM(mySeed: Buffer, peerPub: Buffer, plaintext: Buffer, nonce?: Buffer): Buffer {
  const key = dmSharedKey(mySeed, peerPub)
  const myPub = keyPairFromSeed(mySeed).publicKey
  const n = nonce ?? randomBytes(NONCE_SIZE)
  if (n.length !== NONCE_SIZE) throw new Error('dm: bad nonce size')
  const cipher = createCipheriv('aes-256-gcm', key, n)
  cipher.setAAD(directionAAD(myPub, peerPub))
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([n, ct, cipher.getAuthTag()])
}

export function openDM(mySeed: Buffer, peerPub: Buffer, box: Buffer): Buffer {
  if (box.length < NONCE_SIZE + TAG_SIZE) throw new Error('dm: ciphertext too short')
  const key = dmSharedKey(mySeed, peerPub)
  const myPub = keyPairFromSeed(mySeed).publicKey
  const decipher = createDecipheriv('aes-256-gcm', key, box.subarray(0, NONCE_SIZE))
  decipher.setAAD(directionAAD(peerPub, myPub))
  decipher.setAuthTag(box.subarray(box.length - TAG_SIZE))
  return Buffer.concat([decipher.update(box.subarray(NONCE_SIZE, box.length - TAG_SIZE)), decipher.final()])
}
