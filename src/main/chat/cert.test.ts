import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { issueCertificate, parseCertificate, verifyCertificate } from './cert'
import { parseBroadcast } from './broadcast'

const vectorCandidates = [
  resolve(__dirname, '../../../../TONNET/tonnet-messenger/internal/broadcast/testdata/vectors.json'),
  resolve(__dirname, '../../../../tonnet-messenger/internal/broadcast/testdata/vectors.json'),
]

interface Vectors {
  devicePub: string
  ownerSeed: string
  ownerPub: string
  overlayId: string
  certExpireAt: number
  certMaxSize: number
  certSignature: string
  serializedWithCert: string
}

function loadVectors(): Vectors | null {
  for (const p of vectorCandidates) {
    try {
      return JSON.parse(readFileSync(p, 'utf-8')) as Vectors
    } catch {
      // next
    }
  }
  return null
}

describe('overlay.certificate cross-language vectors', () => {
  const v = loadVectors()
  const guarded = v ? it : it.skip

  guarded('issued certificate is byte-identical to the certificate inside the Go golden broadcast', () => {
    const cert = issueCertificate(
      Buffer.from(v!.ownerSeed, 'hex'),
      Buffer.from(v!.overlayId, 'hex'),
      Buffer.from(v!.devicePub, 'hex'),
      v!.certExpireAt,
      v!.certMaxSize
    )
    const goCert = parseBroadcast(Buffer.from(v!.serializedWithCert, 'hex'))!.certificate
    expect(cert.toString('hex')).toBe(goCert.toString('hex'))
  })

  guarded('certificate signature matches the Go golden vector', () => {
    const cert = parseCertificate(
      issueCertificate(
        Buffer.from(v!.ownerSeed, 'hex'),
        Buffer.from(v!.overlayId, 'hex'),
        Buffer.from(v!.devicePub, 'hex'),
        v!.certExpireAt,
        v!.certMaxSize
      )
    )
    expect(cert).not.toBeNull()
    expect(cert!.signature.toString('hex')).toBe(v!.certSignature)
  })

  guarded('verifyCertificate accepts the owner-issued cert and pins the owner', () => {
    const overlayId = Buffer.from(v!.overlayId, 'hex')
    const member = Buffer.from(v!.devicePub, 'hex')
    const owner = Buffer.from(v!.ownerPub, 'hex')
    const cert = issueCertificate(Buffer.from(v!.ownerSeed, 'hex'), overlayId, member, v!.certExpireAt, v!.certMaxSize)

    expect(verifyCertificate(cert, member, overlayId, 100, owner, v!.certExpireAt - 1)).toBe(true)
    expect(verifyCertificate(cert, member, overlayId, 100, owner, v!.certExpireAt + 1)).toBe(false)
    const notOwner = Buffer.from(v!.devicePub, 'hex')
    expect(verifyCertificate(cert, member, overlayId, 100, notOwner, v!.certExpireAt - 1)).toBe(false)
    const otherMember = Buffer.alloc(32, 9)
    expect(verifyCertificate(cert, otherMember, overlayId, 100, owner, v!.certExpireAt - 1)).toBe(false)
  })
})
