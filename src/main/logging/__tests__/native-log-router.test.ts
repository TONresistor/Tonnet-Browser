import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { configureNativeLogging, flushNativeLogs, NativeLineFramer, nativeLogRouter } from '../native-log-router'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('NativeLineFramer', () => {
  it('reconstructs split UTF-8 and CRLF lines deterministically', () => {
    const lines: string[] = []
    const framer = new NativeLineFramer((line) => lines.push(line))
    const source = Buffer.from('héllo\r\nworld\nlast')
    framer.push(source.subarray(0, 2))
    framer.push(source.subarray(2, 8))
    framer.push(source.subarray(8))
    framer.end()
    expect(lines).toEqual(['héllo', 'world', 'last'])
  })

  it('bounds an unterminated native line', () => {
    const lines: string[] = []
    const framer = new NativeLineFramer((line) => lines.push(line))
    framer.push(Buffer.from('x'.repeat(20_000)))
    framer.end()
    expect(lines).toHaveLength(1)
    expect(Buffer.byteLength(lines[0])).toBeLessThanOrEqual(16 * 1024 + 32)
    expect(lines[0]).toContain('[truncated]')
  })
})

describe('native log router', () => {
  it('writes one redacted JSON record per physical line without promoting stderr', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tonnet-native-log-'))
    dirs.push(dir)
    configureNativeLogging(dir)
    const seen: Array<{ line: string; level: string; stream: string }> = []
    const session = nativeLogRouter.createSession('tonutils-storage', 42, (entry) => seen.push(entry))

    session.stderr(Buffer.from('INFO password=hunter2\nplain stderr\n'))
    session.close()
    await flushNativeLogs()

    const physicalLines = (await readFile(join(dir, 'native.log'), 'utf8')).trim().split('\n')
    expect(physicalLines).toHaveLength(2)
    expect(physicalLines.every((line) => JSON.parse(line))).toBeTruthy()
    expect(physicalLines.join('')).not.toContain('hunter2')
    expect(seen[0]).toMatchObject({ level: 'info', stream: 'stderr' })
    expect(seen[1]).toMatchObject({ level: 'debug', stream: 'stderr' })
  })

  it('rotates native logs within the bounded disk budget', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tonnet-native-rotate-'))
    dirs.push(dir)
    configureNativeLogging(dir)
    const session = nativeLogRouter.createSession('tonutils-proxy', 43)
    const line = `${'x'.repeat(15_000)}\n`
    for (let index = 0; index < 400; index += 1) session.stdout(Buffer.from(line))
    session.close()
    await flushNativeLogs()

    const current = await stat(join(dir, 'native.log'))
    const archived = await stat(join(dir, 'native.old.log'))
    expect(current.size).toBeLessThanOrEqual(5.2 * 1024 * 1024)
    expect(archived.size).toBeLessThanOrEqual(5.2 * 1024 * 1024)
  })

  it('does not reject shutdown when the native log path is unwritable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tonnet-native-failure-'))
    dirs.push(dir)
    const fileInsteadOfDirectory = join(dir, 'not-a-directory')
    await writeFile(fileInsteadOfDirectory, 'occupied')
    configureNativeLogging(fileInsteadOfDirectory)
    const session = nativeLogRouter.createSession('tonutils-storage', 44)
    session.stdout(Buffer.from('INFO ready\n'))
    session.close()
    await expect(flushNativeLogs()).resolves.toBeUndefined()
  })

  it('bounds a burst and records how many low-priority lines were dropped', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tonnet-native-pressure-'))
    dirs.push(dir)
    configureNativeLogging(dir)
    const session = nativeLogRouter.createSession('tonutils-proxy', 45)
    for (let index = 0; index < 5_000; index += 1) session.stdout(Buffer.from(`DEBUG line ${index}\n`))
    session.stderr(Buffer.from('ERROR final failure\n'))
    session.close()
    await flushNativeLogs()

    const records = (await readFile(join(dir, 'native.log'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(records.length).toBeLessThan(5_000)
    expect(records.some((record) => record.event === 'native.logs.dropped')).toBe(true)
    expect(records.some((record) => record.message === 'ERROR final failure')).toBe(true)
  })

  it('preserves a warning when the queue is saturated with info lines', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tonnet-native-warn-priority-'))
    dirs.push(dir)
    configureNativeLogging(dir)
    const session = nativeLogRouter.createSession('tonutils-proxy', 46)
    for (let index = 0; index < 5_000; index += 1) session.stdout(Buffer.from(`INFO line ${index}\n`))
    session.stderr(Buffer.from('WARN final warning\n'))
    session.close()
    await flushNativeLogs()

    const contents = await readFile(join(dir, 'native.log'), 'utf8')
    expect(contents).toContain('WARN final warning')
  })
})
