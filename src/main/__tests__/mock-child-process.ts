/**
 * Shared test helper: a fake ChildProcess (EventEmitter with stdout/stderr/pid/kill).
 * Deduped from proxy/manager.test.ts and storage/daemon.test.ts (OPP-18).
 */
import { vi } from 'vitest'
import { EventEmitter } from 'events'

export type MockChildProcess = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  pid: number
  kill: ReturnType<typeof vi.fn>
}

export function createMockProcess(): MockChildProcess {
  const proc = new EventEmitter() as MockChildProcess
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.pid = 12345
  proc.kill = vi.fn(() => {
    proc.emit('exit', 0)
    return true
  })
  return proc
}
