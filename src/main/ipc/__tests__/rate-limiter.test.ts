import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RateLimiter } from '../validation'

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('permet les appels sous la limite', () => {
    const limiter = new RateLimiter(10, 1000)

    // 5 appels avec une limite de 10 devraient tous passer
    for (let i = 0; i < 5; i++) {
      expect(limiter.check()).toBe(true)
    }
  })

  it('bloque quand la limite est atteinte', () => {
    const limiter = new RateLimiter(10, 1000)

    // 10 appels devraient passer
    for (let i = 0; i < 10; i++) {
      expect(limiter.check()).toBe(true)
    }

    // Le 11eme appel devrait etre bloque
    expect(limiter.check()).toBe(false)
  })

  it('reset apres le delai', () => {
    const limiter = new RateLimiter(10, 1000)

    // Atteindre la limite
    for (let i = 0; i < 10; i++) {
      limiter.check()
    }
    expect(limiter.check()).toBe(false)

    // Avancer le temps au-dela de la fenetre
    vi.advanceTimersByTime(1001)

    // Les appels devraient a nouveau passer
    expect(limiter.check()).toBe(true)
  })

  it('fonctionne avec une limite de 1', () => {
    const limiter = new RateLimiter(1, 1000)

    // Premier appel passe
    expect(limiter.check()).toBe(true)

    // Deuxieme appel bloque
    expect(limiter.check()).toBe(false)

    // Apres le delai, ca repasse
    vi.advanceTimersByTime(1001)
    expect(limiter.check()).toBe(true)
  })

  it('fonctionne avec une limite de 100', () => {
    const limiter = new RateLimiter(100, 1000)

    // 100 appels devraient passer
    for (let i = 0; i < 100; i++) {
      expect(limiter.check()).toBe(true)
    }

    // Le 101eme appel devrait etre bloque
    expect(limiter.check()).toBe(false)
  })

  it('la methode reset() vide les appels', () => {
    const limiter = new RateLimiter(5, 1000)

    // Atteindre la limite
    for (let i = 0; i < 5; i++) {
      limiter.check()
    }
    expect(limiter.check()).toBe(false)

    // Reset
    limiter.reset()

    // Les appels devraient a nouveau passer
    expect(limiter.check()).toBe(true)
  })

  it('expire les anciens appels progressivement', () => {
    const limiter = new RateLimiter(3, 1000)

    // Faire 3 appels
    expect(limiter.check()).toBe(true)
    vi.advanceTimersByTime(400)
    expect(limiter.check()).toBe(true)
    vi.advanceTimersByTime(400)
    expect(limiter.check()).toBe(true)

    // Limite atteinte
    expect(limiter.check()).toBe(false)

    // Avancer de 300ms - le premier appel devrait expirer (400 + 400 + 300 > 1000)
    vi.advanceTimersByTime(300)

    // Un nouvel appel devrait passer car le premier a expire
    expect(limiter.check()).toBe(true)
  })
})
