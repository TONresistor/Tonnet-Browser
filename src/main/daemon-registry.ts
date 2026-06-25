/**
 * Native daemon lifecycle guard.
 *
 * The proxy/storage/bridge daemons are spawned as ordinary child processes, so
 * POSIX never kills them when the Electron main dies abnormally (dev HMR
 * restart, SIGTERM/SIGINT, crash, SIGKILL): they reparent to PID 1 and keep
 * holding their ports, blocking the next launch. Electron's JS quit handlers
 * only run on a graceful quit, so they cannot cover those cases.
 *
 * Defence in depth, all routed through one registry:
 *   - installDaemonSignalHandlers(): on SIGINT/SIGTERM/SIGHUP, kill tracked
 *     daemons synchronously (async cleanup cannot be awaited before exit).
 *   - reapStaleDaemons(): at startup, kill orphans left by a previous run.
 * A persisted PID file bridges the crash/SIGKILL case where no in-process code
 * can run at exit.
 */
import { spawnSync, type ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { createLogger } from '../shared/logger'

const log = createLogger('daemons')

/** pid -> expected binary basename (the PID-reuse guard used at reap time). */
const live = new Map<number, string>()

interface DaemonRecord {
  pid: number
  name: string
}

function registryFile(): string {
  return path.join(app.getPath('userData'), 'daemons.json')
}

function persist(): void {
  try {
    const records: DaemonRecord[] = [...live].map(([pid, name]) => ({ pid, name }))
    fs.writeFileSync(registryFile(), JSON.stringify(records))
  } catch (err) {
    log.warn(`Failed to persist daemon registry: ${String(err)}`)
  }
}

/** Register a freshly spawned daemon. Auto-removes itself when the process exits. */
export function trackDaemon(name: string, proc: ChildProcess): void {
  const { pid } = proc
  if (pid == null) return
  live.set(pid, name)
  persist()
  proc.once('exit', () => untrackDaemon(pid))
}

/** Remove a daemon from the registry. Idempotent. */
export function untrackDaemon(pid: number | undefined): void {
  if (pid != null && live.delete(pid)) persist()
}

/**
 * Force-kill a process and, on Windows, its whole child tree. Node maps
 * SIGKILL to a single-PID TerminateProcess on win32, so a daemon that spawned
 * children (e.g. the proxy's adnl-tunnel) would orphan them and keep the ports
 * held; taskkill /T walks the tree. POSIX keeps the plain SIGKILL.
 */
export function forceKillTree(pid: number): void {
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'])
    } else {
      process.kill(pid, 'SIGKILL')
    }
  } catch {
    /* already gone */
  }
}

interface ProcInfo {
  ppid: number
  command: string
}

/** Inspect a live PID cross-platform. Returns null if the PID is not running. */
function inspectProcess(pid: number): ProcInfo | null {
  try {
    if (process.platform === 'win32') {
      const out =
        spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' }).stdout ?? ''
      return out.includes(`"${pid}"`) ? { ppid: 0, command: out } : null
    }
    const out = (spawnSync('ps', ['-p', String(pid), '-o', 'ppid=,command='], { encoding: 'utf8' }).stdout ?? '').trim()
    const match = out.match(/^(\d+)\s+([\s\S]+)$/) // command may span multiple lines
    return match ? { ppid: Number(match[1]), command: match[2] } : null
  } catch {
    return null
  }
}

/**
 * Startup reaper: SIGKILL daemons left running by a previous run that died
 * without cleanup. Only orphans are killed -- a daemon still owned by a live
 * instance (PPID != 1) is left untouched, and the command must match the
 * recorded binary so a reused PID is never killed by mistake.
 */
export function reapStaleDaemons(): void {
  let records: unknown
  try {
    records = JSON.parse(fs.readFileSync(registryFile(), 'utf8'))
  } catch {
    return // no registry / unreadable -> nothing to reap
  }
  if (!Array.isArray(records)) return

  let reaped = 0
  for (const rec of records as DaemonRecord[]) {
    if (!rec || typeof rec.pid !== 'number' || typeof rec.name !== 'string') continue
    const info = inspectProcess(rec.pid)
    if (!info || !info.command.includes(rec.name)) continue // dead, or PID reused by another process
    if (process.platform !== 'win32' && info.ppid !== 1) continue // owned by a live instance
    forceKillTree(rec.pid)
    reaped++
    log.info(`Reaped orphaned ${rec.name} (pid ${rec.pid}) from a previous run`)
  }
  if (reaped > 0) log.info(`Reaped ${reaped} orphaned daemon(s)`)
}

/**
 * Synchronously SIGKILL every tracked daemon. Used by the signal handlers, where
 * async teardown cannot be awaited before the process exits.
 */
function killAllDaemonsSync(): void {
  for (const pid of live.keys()) {
    forceKillTree(pid)
  }
  live.clear()
  try {
    fs.unlinkSync(registryFile())
  } catch {
    /* nothing to remove */
  }
}

let signalHandlersInstalled = false

/** Install POSIX signal handlers that kill daemons before the process exits. */
export function installDaemonSignalHandlers(): void {
  if (signalHandlersInstalled) return
  signalHandlersInstalled = true
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
      killAllDaemonsSync()
      process.exit(0)
    })
  }
}
