import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { spawn, trackDaemon, killChildProcess } = vi.hoisted(() => ({
  spawn: vi.fn(),
  trackDaemon: vi.fn(),
  killChildProcess: vi.fn(() => Promise.resolve()),
}))

vi.mock('child_process', () => ({ spawn }))
vi.mock('../../daemon-registry', () => ({ trackDaemon }))
vi.mock('../../proxy/process-utils', () => ({ killChildProcess }))

import { NativeProcessSupervisor } from '../supervisor'

function processMock() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    pid: number
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.pid = 42
  return child
}

describe('NativeProcessSupervisor', () => {
  beforeEach(() => vi.clearAllMocks())

  it('owns spawn, output callbacks, registry tracking, and exit cleanup', () => {
    const child = processMock()
    spawn.mockReturnValue(child)
    const stdout = vi.fn()
    const onExit = vi.fn()
    const supervisor = new NativeProcessSupervisor()

    expect(
      supervisor.start({ name: 'daemon', command: '/bin/daemon', args: ['--flag'], onStdout: stdout, onExit })
    ).toBe(child)
    child.stdout.emit('data', Buffer.from('ready'))
    child.emit('exit', 0)

    expect(spawn).toHaveBeenCalledWith('/bin/daemon', ['--flag'], {})
    expect(trackDaemon).toHaveBeenCalledWith('daemon', child)
    expect(stdout).toHaveBeenCalled()
    expect(onExit).toHaveBeenCalledWith(0)
    expect(supervisor.isRunning).toBe(false)
  })

  it('makes duplicate start idempotent and concurrent stop single-flight', async () => {
    const child = processMock()
    spawn.mockReturnValue(child)
    let release!: () => void
    killChildProcess.mockReturnValueOnce(new Promise<void>((resolve) => (release = resolve)))
    const supervisor = new NativeProcessSupervisor()
    const firstChild = supervisor.start({ name: 'daemon', command: '/bin/daemon', args: [] })

    expect(supervisor.start({ name: 'daemon', command: '/bin/daemon', args: [] })).toBe(firstChild)
    expect(spawn).toHaveBeenCalledOnce()
    const first = supervisor.stop()
    const second = supervisor.stop()
    expect(first).toBe(second)
    expect(supervisor.isRunning).toBe(false)
    release()
    await first
    expect(killChildProcess).toHaveBeenCalledOnce()
  })

  it('rejects a new start until the previous process has stopped', async () => {
    const first = processMock()
    const second = processMock()
    spawn.mockReturnValueOnce(first).mockReturnValueOnce(second)
    let release!: () => void
    killChildProcess.mockReturnValueOnce(new Promise<void>((resolve) => (release = resolve)))
    const supervisor = new NativeProcessSupervisor()
    supervisor.start({ name: 'daemon', command: '/bin/daemon', args: [] })

    const stopping = supervisor.stop()

    expect(() => supervisor.start({ name: 'daemon', command: '/bin/daemon', args: [] })).toThrow('stop is in progress')
    expect(spawn).toHaveBeenCalledOnce()

    release()
    await stopping
    expect(supervisor.start({ name: 'daemon', command: '/bin/daemon', args: [] })).toBe(second)
  })

  it('clears ownership on spawn errors', () => {
    const child = processMock()
    spawn.mockReturnValue(child)
    const onError = vi.fn()
    const supervisor = new NativeProcessSupervisor()
    supervisor.start({ name: 'daemon', command: '/missing', args: [], onError })
    child.emit('error', new Error('ENOENT'))
    expect(onError).toHaveBeenCalled()
    expect(supervisor.isRunning).toBe(false)
    expect(supervisor.state).toBe('crashed')
  })

  it('flushes an unterminated native line when stopped', async () => {
    const child = processMock()
    spawn.mockReturnValue(child)
    const onLine = vi.fn()
    const supervisor = new NativeProcessSupervisor()
    supervisor.start({ name: 'daemon', command: '/bin/daemon', args: [], onLine })

    child.stdout.emit('data', Buffer.from('partial line'))
    expect(onLine).not.toHaveBeenCalled()
    await supervisor.stop()

    expect(onLine).toHaveBeenCalledWith(expect.objectContaining({ line: 'partial line', stream: 'stdout' }))
  })

  it('keeps draining child pipes between exit and close', () => {
    const child = processMock()
    spawn.mockReturnValue(child)
    const onLine = vi.fn()
    const supervisor = new NativeProcessSupervisor()
    supervisor.start({ name: 'daemon', command: '/bin/daemon', args: [], onLine })

    child.emit('exit', 17)
    child.stderr.emit('data', Buffer.from('ERROR final crash detail\n'))
    child.emit('close', 17)

    expect(onLine).toHaveBeenCalledWith(
      expect.objectContaining({ line: 'ERROR final crash detail', stream: 'stderr', level: 'error' })
    )
  })

  it('resolves a bounded injected readiness probe', async () => {
    const child = processMock()
    spawn.mockReturnValue(child)
    const supervisor = new NativeProcessSupervisor()
    supervisor.start({ name: 'daemon', command: '/bin/daemon', args: [] })
    const probe = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    await supervisor.waitForReady({ probe, timeoutMs: 100, intervalMs: 1 })

    expect(probe).toHaveBeenCalledTimes(2)
    expect(supervisor.state).toBe('running')
  })

  it('rejects readiness immediately when the process crashes', async () => {
    const child = processMock()
    spawn.mockReturnValue(child)
    const supervisor = new NativeProcessSupervisor()
    supervisor.start({ name: 'daemon', command: '/bin/daemon', args: [] })
    const waiting = supervisor.waitForReady({ probe: () => false, timeoutMs: 1_000, intervalMs: 100 })

    child.emit('exit', 17)

    await expect(waiting).rejects.toThrow('exited before ready')
    expect(supervisor.state).toBe('crashed')
  })

  it('supports bounded output-based readiness with listener cleanup', async () => {
    const child = processMock()
    spawn.mockReturnValue(child)
    const supervisor = new NativeProcessSupervisor()
    supervisor.start({ name: 'daemon', command: '/bin/daemon', args: [] })
    const stdoutBaseline = child.stdout.listenerCount('data')
    const stderrBaseline = child.stderr.listenerCount('data')
    const waiting = supervisor.waitForOutput({
      matches: (data) => data.toString().includes('LISTENING'),
      timeoutMs: 1_000,
    })
    child.stderr.emit('data', Buffer.from('LISTENING 127.0.0.1'))
    await waiting
    expect(child.stdout.listenerCount('data')).toBe(stdoutBaseline)
    expect(child.stderr.listenerCount('data')).toBe(stderrBaseline)
  })

  it('recognizes readiness output emitted before the wait starts', async () => {
    const child = processMock()
    spawn.mockReturnValue(child)
    const supervisor = new NativeProcessSupervisor()
    supervisor.start({ name: 'daemon', command: '/bin/daemon', args: [] })
    child.stdout.emit('data', Buffer.from('LISTENING 127.0.0.1'))

    await expect(
      supervisor.waitForOutput({ matches: (data) => data.toString().includes('LISTENING'), timeoutMs: 10 })
    ).resolves.toBeUndefined()
  })

  it('recognizes a readiness marker split across output chunks', async () => {
    const child = processMock()
    spawn.mockReturnValue(child)
    const supervisor = new NativeProcessSupervisor()
    supervisor.start({ name: 'daemon', command: '/bin/daemon', args: [] })
    const waiting = supervisor.waitForOutput({
      matches: (data) => data.toString().includes('LISTENING'),
      timeoutMs: 1_000,
    })

    child.stderr.emit('data', Buffer.from('LIST'))
    child.stderr.emit('data', Buffer.from('ENING'))

    await expect(waiting).resolves.toBeUndefined()
  })

  it('classifies a port-conflict exit as a readiness failure and crash', async () => {
    const child = processMock()
    spawn.mockReturnValue(child)
    const supervisor = new NativeProcessSupervisor()
    supervisor.start({ name: 'daemon', command: '/bin/daemon', args: [] })
    const waiting = supervisor.waitForOutput({ matches: () => false, timeoutMs: 1_000 })

    child.stderr.emit('data', Buffer.from('listen tcp 127.0.0.1:8080: bind: address already in use'))
    child.emit('exit', 1)

    await expect(waiting).rejects.toThrow('exited before ready')
    expect(supervisor.state).toBe('crashed')
  })

  it('times out a readiness probe that never succeeds', async () => {
    vi.useFakeTimers()
    const child = processMock()
    spawn.mockReturnValue(child)
    const supervisor = new NativeProcessSupervisor()
    supervisor.start({ name: 'daemon', command: '/bin/daemon', args: [] })
    const waiting = supervisor.waitForReady({ probe: () => false, timeoutMs: 50, intervalMs: 10 })
    const rejection = expect(waiting).rejects.toThrow('readiness timed out')
    await vi.advanceTimersByTimeAsync(60)
    await rejection
    vi.useRealTimers()
  })

  it('makes concurrent restart calls single-flight', async () => {
    const first = processMock()
    const second = processMock()
    second.pid = 43
    spawn.mockReturnValueOnce(first).mockReturnValueOnce(second)
    const supervisor = new NativeProcessSupervisor()
    supervisor.start({ name: 'daemon', command: '/bin/daemon', args: [] })
    const one = supervisor.restart()
    const two = supervisor.restart()
    expect(one).toBe(two)
    await one
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('owns bounded exponential backoff and keeps concurrent retry callers single-flight', async () => {
    vi.useFakeTimers()
    const supervisor = new NativeProcessSupervisor()
    const operation = vi.fn().mockRejectedValueOnce(new Error('crash')).mockResolvedValue('ready')
    const onRetry = vi.fn()
    const first = supervisor.runWithBackoff(operation, {
      maxAttempts: 3,
      initialDelayMs: 10,
      multiplier: 2,
      maxDelayMs: 100,
      onRetry,
    })
    const second = supervisor.runWithBackoff(operation, { maxAttempts: 1, initialDelayMs: 0 })

    expect(second).toBe(first)
    await vi.advanceTimersByTimeAsync(10)
    await expect(first).resolves.toBe('ready')
    expect(operation).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, 10)
    vi.useRealTimers()
  })

  it('aborts a pending backoff without running another attempt', async () => {
    vi.useFakeTimers()
    const supervisor = new NativeProcessSupervisor()
    const controller = new AbortController()
    const operation = vi.fn(async () => {
      throw new Error('crash')
    })
    const running = supervisor.runWithBackoff(operation, {
      maxAttempts: 3,
      initialDelayMs: 100,
      signal: controller.signal,
    })
    controller.abort()

    await expect(running).rejects.toThrow('retry aborted')
    expect(operation).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('rejects an output readiness wait when its signal is already aborted', async () => {
    const child = processMock()
    spawn.mockReturnValue(child)
    const supervisor = new NativeProcessSupervisor()
    const controller = new AbortController()
    supervisor.start({ name: 'daemon', command: '/bin/daemon', args: [] })
    controller.abort()

    await expect(
      supervisor.waitForOutput({
        matches: () => false,
        timeoutMs: 0,
        signal: controller.signal,
      })
    ).rejects.toThrow('aborted')
  })
})
