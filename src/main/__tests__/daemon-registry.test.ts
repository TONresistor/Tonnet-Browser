/**
 * daemon-registry tests.
 * The reaper is safety-critical (it SIGKILLs processes), so it must kill only
 * true orphans and never a live instance's daemon or a reused PID.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockProcess } from './mock-child-process'

vi.mock('electron', () => ({ app: { getPath: () => '/mock/userData' } }))
vi.mock('fs', () => {
  const m = { writeFileSync: vi.fn(), readFileSync: vi.fn(), unlinkSync: vi.fn() }
  return { default: m, ...m }
})
vi.mock('child_process', () => ({ spawnSync: vi.fn() }))

import fs from 'fs'
import { spawnSync } from 'child_process'
import { trackDaemon, untrackDaemon, reapStaleDaemons } from '../daemon-registry'

const readFileSync = fs.readFileSync as unknown as ReturnType<typeof vi.fn>
const writeFileSync = fs.writeFileSync as unknown as ReturnType<typeof vi.fn>
const spawnSyncMock = spawnSync as unknown as ReturnType<typeof vi.fn>

const ps = (stdout: string) => ({ stdout }) as unknown as ReturnType<typeof spawnSync>

beforeEach(() => {
  vi.clearAllMocks()
})

describe('trackDaemon / untrackDaemon', () => {
  it('persists the pid on track and removes it on untrack', () => {
    const proc = createMockProcess() // pid 12345

    trackDaemon('tonutils-proxy', proc as never)
    expect(writeFileSync).toHaveBeenLastCalledWith(
      '/mock/userData/daemons.json',
      JSON.stringify([{ pid: 12345, name: 'tonutils-proxy' }])
    )

    untrackDaemon(12345)
    expect(writeFileSync).toHaveBeenLastCalledWith('/mock/userData/daemons.json', JSON.stringify([]))
  })
})

describe('reapStaleDaemons', () => {
  it('kills only the orphaned daemon (ppid 1 + command matches)', () => {
    readFileSync.mockReturnValue(
      JSON.stringify([
        { pid: 111, name: 'tonutils-proxy' }, // orphan, matches -> KILL
        { pid: 222, name: 'tonutils-storage' }, // owned by a live instance -> keep
        { pid: 333, name: 'tonutils-bridge' }, // dead -> keep
        { pid: 444, name: 'tonutils-proxy' }, // PID reused by another process -> keep
      ])
    )
    spawnSyncMock.mockImplementation((_cmd: string, argv: string[]) => {
      switch (argv[1]) {
        case '111':
          return ps('    1 /opt/app/tonutils-proxy -addr 127.0.0.1:8080')
        case '222':
          return ps('  98765 /opt/app/tonutils-storage -daemon')
        case '333':
          return ps('') // not running
        case '444':
          return ps('    1 /usr/bin/python3 unrelated')
        default:
          return ps('')
      }
    })
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)

    reapStaleDaemons()

    expect(killSpy).toHaveBeenCalledTimes(1)
    expect(killSpy).toHaveBeenCalledWith(111, 'SIGKILL')
    killSpy.mockRestore()
  })

  it('does nothing when the registry is missing or unreadable', () => {
    readFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)

    expect(() => reapStaleDaemons()).not.toThrow()
    expect(killSpy).not.toHaveBeenCalled()
    killSpy.mockRestore()
  })
})
