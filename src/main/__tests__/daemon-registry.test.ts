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
vi.mock('../utils/secure-fs', () => ({ writeSecureJsonAtomic: vi.fn() }))

import fs from 'fs'
import { spawnSync } from 'child_process'
import { trackDaemon, untrackDaemon, reapStaleDaemons, killAllDaemonsSync } from '../daemon-registry'
import { writeSecureJsonAtomic } from '../utils/secure-fs'

const readFileSync = fs.readFileSync as unknown as ReturnType<typeof vi.fn>
const writeRegistry = writeSecureJsonAtomic as unknown as ReturnType<typeof vi.fn>
const spawnSyncMock = spawnSync as unknown as ReturnType<typeof vi.fn>

const ps = (stdout: string) => ({ stdout }) as unknown as ReturnType<typeof spawnSync>

beforeEach(() => {
  vi.clearAllMocks()
})

describe('trackDaemon / untrackDaemon', () => {
  it('persists the pid on track and removes it on untrack', () => {
    const proc = createMockProcess() // pid 12345

    trackDaemon('tonutils-proxy', proc as never)
    expect(writeRegistry).toHaveBeenLastCalledWith('/mock/userData/daemons.json', {
      schemaVersion: 1,
      records: [{ pid: 12345, name: 'tonutils-proxy' }],
    })

    untrackDaemon(12345)
    expect(writeRegistry).toHaveBeenLastCalledWith('/mock/userData/daemons.json', {
      schemaVersion: 1,
      records: [],
    })
  })

  it('kills every tracked daemon synchronously', () => {
    const first = createMockProcess()
    const second = createMockProcess()
    second.pid = 12346
    trackDaemon('tonutils-proxy', first as never)
    trackDaemon('tonutils-storage', second as never)
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)

    killAllDaemonsSync()

    if (process.platform === 'win32') {
      expect(spawnSyncMock).toHaveBeenCalledWith('taskkill', ['/PID', '12345', '/T', '/F'])
      expect(spawnSyncMock).toHaveBeenCalledWith('taskkill', ['/PID', '12346', '/T', '/F'])
    } else {
      expect(killSpy).toHaveBeenCalledWith(12345, 'SIGKILL')
      expect(killSpy).toHaveBeenCalledWith(12346, 'SIGKILL')
    }
    expect(fs.unlinkSync).toHaveBeenCalledWith('/mock/userData/daemons.json')
    killSpy.mockRestore()
  })
})

describe('reapStaleDaemons', () => {
  it('kills every command-matched orphan regardless of ppid (systemd-user reparenting)', () => {
    readFileSync.mockReturnValue(
      JSON.stringify([
        { pid: 111, name: 'tonutils-proxy' }, // orphan reparented to init -> KILL
        { pid: 222, name: 'tonutils-storage' }, // orphan reparented to systemd --user -> KILL
        { pid: 333, name: 'tonutils-bridge' }, // dead -> keep
        { pid: 444, name: 'tonutils-proxy' }, // PID reused by another process -> keep
      ])
    )
    spawnSyncMock.mockImplementation((_cmd: string, argv: string[]) => {
      switch (argv[1]) {
        case '111':
          return ps('    1 /opt/app/tonutils-proxy -addr 127.0.0.1:8080')
        case '222':
          return ps('  98765 /opt/app/tonutils-storage -daemon') // ppid != 1 (user manager)
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

    expect(killSpy).toHaveBeenCalledWith(111, 'SIGKILL')
    expect(killSpy).toHaveBeenCalledWith(222, 'SIGKILL')
    expect(killSpy).not.toHaveBeenCalledWith(333, 'SIGKILL')
    expect(killSpy).not.toHaveBeenCalledWith(444, 'SIGKILL')
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

  it('loads the current versioned registry envelope', () => {
    readFileSync.mockReturnValue(JSON.stringify({ schemaVersion: 1, records: [{ pid: 111, name: 'tonutils-proxy' }] }))
    spawnSyncMock.mockReturnValue(ps('    1 /opt/app/tonutils-proxy'))
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)

    reapStaleDaemons()

    expect(killSpy).toHaveBeenCalledWith(111, 'SIGKILL')
    killSpy.mockRestore()
  })
})
