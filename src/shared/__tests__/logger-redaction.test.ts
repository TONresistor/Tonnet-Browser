import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import log, { configureApplicationLogging, createLogger, redactLogValue, redactNativeLogLine } from '../logger'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('central log redaction', () => {
  it('redacts secret-bearing fields recursively without mutating safe metadata', () => {
    const value = redactLogValue({
      subsystem: 'wallet',
      operation: 'sign',
      nested: {
        mnemonic: 'one two three',
        privateKey: 'deadbeef',
        token: 'opaque',
        address: 'EQ-private',
      },
    })

    expect(value).toEqual({
      subsystem: 'wallet',
      operation: 'sign',
      nested: {
        mnemonic: '[REDACTED]',
        privateKey: '[REDACTED]',
        token: '[REDACTED]',
        address: '[REDACTED]',
      },
    })
  })

  it('redacts labeled secrets, authorization material, BOCs, and raw binary data', () => {
    const fullBoc = `te6cc${'A'.repeat(48)}`
    const fullHex = 'ab'.repeat(80)
    const text = redactLogValue(`authorization=Bearer abc.def seed:correct-horse boc=${fullBoc} payload=${fullHex}`)

    expect(text).not.toContain('abc.def')
    expect(text).not.toContain('correct-horse')
    expect(text).not.toContain(fullBoc)
    expect(text).not.toContain(fullHex)
    expect(redactLogValue(Buffer.from('secret'))).toBe('[Binary 6 bytes]')
  })

  it('sanitizes errors and circular values', () => {
    const circular: Record<string, unknown> = { error: new Error('token=opaque') }
    circular.self = circular

    expect(redactLogValue(circular)).toEqual({
      error: expect.objectContaining({ 'exception.message': 'token=[REDACTED]' }),
      self: '[Circular]',
    })
  })

  it('neutralizes log injection and bounds hostile attributes', () => {
    const value = redactLogValue(`first\r\n[error] forged\u0000${'x'.repeat(20_000)}`)
    expect(value).not.toContain('\r')
    expect(value).not.toContain('\n')
    expect(value).not.toContain('\u0000')
    expect(String(value).length).toBeLessThanOrEqual(16 * 1024)
  })

  it('redacts API keys, cookies, logins, passwords, and session identifiers', () => {
    expect(
      redactLogValue({
        apiKey: 'a',
        indexerApiKey: 'nested-a',
        cookie: 'b',
        login: 'c',
        password: 'd',
        sessionId: 'e',
        safe: true,
      })
    ).toEqual({
      apiKey: '[REDACTED]',
      indexerApiKey: '[REDACTED]',
      cookie: '[REDACTED]',
      login: '[REDACTED]',
      password: '[REDACTED]',
      sessionId: '[REDACTED]',
      safe: true,
    })
  })

  it('removes navigation and machine identity from native output', () => {
    const value = redactNativeLogLine(
      'host=manifesto.ton remote=192.0.2.4:443 url=https://secret.example/path file=/Users/alice/private/db'
    )
    expect(value).not.toContain('manifesto.ton')
    expect(value).not.toContain('192.0.2.4')
    expect(value).not.toContain('secret.example')
    expect(value).not.toContain('/Users/alice')
  })

  it('removes public URLs while preserving local development source locations', () => {
    expect(redactLogValue('open https://private.example/path')).toBe('open [URL]')
    expect(redactLogValue('at http://localhost:5173/src/App.tsx:12')).toBe('at http://localhost:5173/src/App.tsx:12')
  })

  it('removes bare domains, room identifiers, TON addresses, and UUIDs', () => {
    const value = String(
      redactLogValue(`manifesto.ton tonnet:groupchat EQ${'A'.repeat(46)} 123e4567-e89b-12d3-a456-426614174000`)
    )
    expect(value).not.toContain('manifesto.ton')
    expect(value).not.toContain('tonnet:groupchat')
    expect(value).not.toContain(`EQ${'A'.repeat(46)}`)
    expect(value).not.toContain('123e4567-e89b-12d3-a456-426614174000')
  })

  it('keeps routine info out of the default console and admits explicit status events', () => {
    const output: unknown[][] = []
    const previousLevel = log.transports.console.level
    const previousWrite = log.transports.console.writeFn
    log.transports.console.level = 'info'
    log.transports.console.writeFn = ({ message }) => output.push(message.data)
    const scoped = createLogger('boot')

    scoped.info('routine initialization detail')
    scoped.status('boot.ready', 'browser ready')

    expect(output).toHaveLength(1)
    expect(String(output[0][0])).toContain('browser ready')
    log.transports.console.level = previousLevel
    log.transports.console.writeFn = previousWrite
  })

  it('writes a private single-line structured application record', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tonnet-app-log-'))
    dirs.push(dir)
    const file = join(dir, 'app.log')
    const previousPath = log.transports.file.resolvePathFn
    const previousConsoleLevel = log.transports.console.level
    try {
      log.transports.file.resolvePathFn = () => file
      log.transports.console.level = false
      configureApplicationLogging('test-version')

      createLogger('wallet').event('info', 'wallet.test', 'line one\nline two', { token: 'opaque', safe: 7 })

      const physicalLines = (await readFile(file, 'utf8')).trim().split('\n')
      expect(physicalLines).toHaveLength(1)
      const record = JSON.parse(physicalLines[0])
      expect(record).toMatchObject({
        level: 'info',
        scope: 'wallet',
        event: 'wallet.test',
        appVersion: 'test-version',
        safe: 7,
        token: '[REDACTED]',
      })
      expect(record.message).toBe('line one ↵ line two')
      expect((await stat(file)).mode & 0o777).toBe(0o600)
    } finally {
      log.transports.file.resolvePathFn = previousPath
      log.transports.console.level = previousConsoleLevel
    }
  })
})
