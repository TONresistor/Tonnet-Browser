import { describe, it, expect } from 'vitest'
import { issueCertificate, parseCertificate, verifyCertificate } from './cert'
import { parseBroadcast } from './broadcast'

import vectors from './__tests__/fixtures/messenger-go-vectors.json'

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

describe('overlay.certificate cross-language vectors', () => {
  const v = vectors as Vectors

  it('issued certificate is byte-identical to the certificate inside the Go golden broadcast', () => {
    const cert = issueCertificate(
      Buffer.from(v.ownerSeed, 'hex'),
      Buffer.from(v.overlayId, 'hex'),
      Buffer.from(v.devicePub, 'hex'),
      v.certExpireAt,
      v.certMaxSize
    )
    const goCert = parseBroadcast(Buffer.from(v.serializedWithCert, 'hex'))!.certificate
    expect(cert.toString('hex')).toBe(goCert.toString('hex'))
  })

  it('certificate signature matches the Go golden vector', () => {
    const cert = parseCertificate(
      issueCertificate(
        Buffer.from(v.ownerSeed, 'hex'),
        Buffer.from(v.overlayId, 'hex'),
        Buffer.from(v.devicePub, 'hex'),
        v.certExpireAt,
        v.certMaxSize
      )
    )
    expect(cert).not.toBeNull()
    expect(cert!.signature.toString('hex')).toBe(v.certSignature)
  })

  it('verifyCertificate accepts the owner-issued cert and pins the owner', () => {
    const overlayId = Buffer.from(v.overlayId, 'hex')
    const member = Buffer.from(v.devicePub, 'hex')
    const owner = Buffer.from(v.ownerPub, 'hex')
    const cert = issueCertificate(Buffer.from(v.ownerSeed, 'hex'), overlayId, member, v.certExpireAt, v.certMaxSize)

    expect(verifyCertificate(cert, member, overlayId, 100, owner, v.certExpireAt - 1)).toBe(true)
    expect(verifyCertificate(cert, member, overlayId, 100, owner, v.certExpireAt + 1)).toBe(false)
    const notOwner = Buffer.from(v.devicePub, 'hex')
    expect(verifyCertificate(cert, member, overlayId, 100, notOwner, v.certExpireAt - 1)).toBe(false)
    const otherMember = Buffer.alloc(32, 9)
    expect(verifyCertificate(cert, otherMember, overlayId, 100, owner, v.certExpireAt - 1)).toBe(false)
  })
})
