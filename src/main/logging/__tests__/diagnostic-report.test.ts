import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildDiagnosticReport } from '../diagnostic-report'
import { configureNativeLogging, flushNativeLogs, nativeLogRouter } from '../native-log-router'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('diagnostic report', () => {
  it('copies only bounded, parsed, privacy-scrubbed records', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tonnet-report-'))
    dirs.push(dir)
    const records = Array.from({ length: 120 }, (_, index) =>
      JSON.stringify({ event: `event-${index}`, domain: 'private.ton', message: 'url=https://private.example/path' })
    )
    await writeFile(join(dir, 'app.log'), `${records.join('\n')}\nmalformed\n`)
    await writeFile(
      join(dir, 'native.log'),
      `${JSON.stringify({ source: 'proxy', message: 'host=private.ton remote=192.0.2.1:80' })}\n`
    )

    const reportText = await buildDiagnosticReport(dir, {
      appVersion: '2.3.1',
      diagnosticLogging: { enabled: false, until: null },
    })
    const report = JSON.parse(reportText)

    expect(report.applicationEvents).toHaveLength(100)
    expect(report.applicationEvents[0].event).toBe('event-20')
    expect(reportText).not.toContain('private.ton')
    expect(reportText).not.toContain('private.example')
    expect(reportText).not.toContain('192.0.2.1')
    expect(await readFile(join(dir, 'app.log'), 'utf8')).toContain('private.ton')
  })

  it('still builds when log files do not exist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tonnet-report-empty-'))
    dirs.push(dir)
    const report = JSON.parse(
      await buildDiagnosticReport(dir, {
        appVersion: '2.3.1',
        diagnosticLogging: { enabled: false, until: null },
      })
    )
    expect(report.applicationEvents).toEqual([])
    expect(report.nativeEvents).toEqual([])
  })

  it('does not leak bare identities or values hidden beyond the depth limit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tonnet-report-depth-'))
    dirs.push(dir)
    const deep = { one: { two: { three: { four: { five: { six: { domain: 'deep-private.ton' } } } } } } }
    await writeFile(
      join(dir, 'app.log'),
      `${JSON.stringify({
        message: 'manifesto.ton tonnet:groupchat 123e4567-e89b-12d3-a456-426614174000',
        deep,
      })}\n`
    )

    const report = await buildDiagnosticReport(dir, {
      appVersion: '2.3.1',
      diagnosticLogging: { enabled: false, until: null },
    })
    expect(report).not.toContain('manifesto.ton')
    expect(report).not.toContain('tonnet:groupchat')
    expect(report).not.toContain('123e4567-e89b-12d3-a456-426614174000')
    expect(report).not.toContain('deep-private.ton')
  })

  it('includes the latest queued native event after a full flush', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tonnet-report-flush-'))
    dirs.push(dir)
    configureNativeLogging(dir)
    const session = nativeLogRouter.createSession('tonutils-proxy', 47)
    session.stderr(Buffer.from('ERROR latest incident\n'))
    session.close()

    await flushNativeLogs()
    const report = await buildDiagnosticReport(dir, {
      appVersion: '2.3.1',
      diagnosticLogging: { enabled: false, until: null },
    })
    expect(report).toContain('ERROR latest incident')
  })
})
