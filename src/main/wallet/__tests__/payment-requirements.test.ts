import { describe, expect, it } from 'vitest'
import type { PaymentRequirements } from '../../../shared/types'
import {
  MAX_PAYMENT_RESPONSE_BYTES,
  parsePaymentRequirements,
  resolveAutoPayMode,
  validatePaymentRequirements,
} from '../payment-requirements'

const requirements: PaymentRequirements = {
  scheme: 'exact',
  network: 'tvm:-239',
  asset: 'native',
  amount: '1000',
  payTo: `0:${'a'.repeat(64)}`,
  maxTimeoutSeconds: 60,
}

const context = {
  originalDomain: 'shop.ton',
  finalDomain: 'shop.ton',
  isAutoMode: false,
  walletState: { isCreated: true, addressRaw: `0:${'b'.repeat(64)}` },
  perRequestLimit: '0',
}

describe('payment requirements policy', () => {
  it('validates the canonical TON payment', () => {
    expect(validatePaymentRequirements(requirements, context)).toEqual({ valid: true })
  })

  it('rejects self-payment, cross-domain auto mode, and configured limits', () => {
    expect(
      validatePaymentRequirements(requirements, {
        ...context,
        walletState: { ...context.walletState, addressRaw: requirements.payTo },
      }).reason
    ).toBe('Self-payment not allowed')
    expect(
      validatePaymentRequirements(requirements, { ...context, finalDomain: 'evil.ton', isAutoMode: true }).reason
    ).toBe('Cross-domain redirect in auto mode')
    expect(validatePaymentRequirements(requirements, { ...context, perRequestLimit: '999' }).reason).toBe(
      'amount_exceeds_limit'
    )
  })

  it('escalates auto-pay above its zero-approval ceiling', () => {
    expect(resolveAutoPayMode('auto', '1001', '1000')).toBe('manual')
    expect(resolveAutoPayMode('auto', '1000', '1000')).toBe('auto')
    expect(resolveAutoPayMode('manual', '999999', '1')).toBe('manual')
  })

  it('parses bounded responses and rejects advertised oversize', async () => {
    await expect(
      parsePaymentRequirements(new Response(JSON.stringify(requirements), { status: 402 }))
    ).resolves.toEqual(requirements)
    const oversized = new Response('{}', {
      status: 402,
      headers: { 'content-length': String(MAX_PAYMENT_RESPONSE_BYTES + 1) },
    })
    await expect(parsePaymentRequirements(oversized)).rejects.toThrow('exceeds')
  })
})
