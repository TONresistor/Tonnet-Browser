import { EventEmitter } from 'events'
import { ProcessSupervisor, ProcessState, SupervisorConfig } from '../supervisor'

vi.mock('../../../shared/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => '12345'),
  unlinkSync: vi.fn(),
}))

function createMockChildProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    stdin: { write: ReturnType<typeof vi.fn> }
    pid: number
    kill: ReturnType<typeof vi.fn>
  }
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.stdin = { write: vi.fn() }
  proc.pid = 12345
  proc.kill = vi.fn(() => true)
  return proc
}

function createConfig(overrides: Partial<SupervisorConfig> = {}): SupervisorConfig & {
  mockProcess: ReturnType<typeof createMockChildProcess>
} {
  const mockProcess = createMockChildProcess()
  return {
    name: 'test-process',
    spawn: vi.fn(() => mockProcess),
    mockProcess,
    ...overrides,
  }
}

describe('ProcessSupervisor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('start() transitions', () => {
    it('transitions STOPPED -> STARTING -> RUNNING with readiness probe', async () => {
      const states: ProcessState[] = []
      const config = createConfig({
        readinessProbe: vi.fn().mockResolvedValue(true),
      })
      const supervisor = new ProcessSupervisor(config)
      supervisor.on('state-change', (_old: ProcessState, newState: ProcessState) => {
        states.push(newState)
      })

      const startPromise = supervisor.start()
      // Allow readiness poll to run
      await vi.advanceTimersByTimeAsync(100)
      await startPromise

      expect(states).toEqual(['starting', 'running'])
      expect(supervisor.getState()).toBe('running')
      expect(config.spawn).toHaveBeenCalledOnce()

      supervisor.destroy()
    })

    it('transitions STOPPED -> STARTING -> RUNNING without readiness probe', async () => {
      const config = createConfig()
      const supervisor = new ProcessSupervisor(config)

      await supervisor.start()

      expect(supervisor.getState()).toBe('running')

      supervisor.destroy()
    })

    it('transitions to CRASHED on readiness timeout', async () => {
      const states: ProcessState[] = []
      const config = createConfig({
        readinessProbe: vi.fn().mockResolvedValue(false),
        readinessTimeoutMs: 2000,
      })
      const supervisor = new ProcessSupervisor(config)
      supervisor.on('state-change', (_old: ProcessState, newState: ProcessState) => {
        states.push(newState)
      })

      const startPromise = supervisor.start()
      // Advance past readiness timeout
      await vi.advanceTimersByTimeAsync(3000)
      await startPromise

      expect(states).toContain('starting')
      expect(states).toContain('crashed')

      supervisor.destroy()
    })
  })

  describe('unexpected process exit', () => {
    it('transitions RUNNING -> CRASHED -> BACKOFF on unexpected exit', async () => {
      const states: ProcessState[] = []
      const config = createConfig()
      const supervisor = new ProcessSupervisor(config)
      supervisor.on('state-change', (_old: ProcessState, newState: ProcessState) => {
        states.push(newState)
      })

      await supervisor.start()
      expect(supervisor.getState()).toBe('running')

      // Simulate unexpected exit
      config.mockProcess.emit('exit', 1, null)

      expect(states).toContain('crashed')
      expect(states).toContain('backoff')

      supervisor.destroy()
    })

    it('restarts after backoff', async () => {
      const proc1 = createMockChildProcess()
      const proc2 = createMockChildProcess()
      let spawnCount = 0
      const config = createConfig({
        spawn: vi.fn(() => {
          spawnCount++
          return spawnCount === 1 ? proc1 : proc2
        }),
      })
      const supervisor = new ProcessSupervisor(config)

      await supervisor.start()
      expect(supervisor.getState()).toBe('running')

      // Crash it
      proc1.emit('exit', 1, null)
      expect(supervisor.getState()).toBe('backoff')

      // Advance past backoff (base 1000ms + jitter)
      await vi.advanceTimersByTimeAsync(2000)

      // Should have restarted
      expect(config.spawn).toHaveBeenCalledTimes(2)

      supervisor.destroy()
    })
  })

  describe('backoff timing', () => {
    it('uses exponential backoff with increasing delays', async () => {
      const processes: ReturnType<typeof createMockChildProcess>[] = []
      const config = createConfig({
        spawn: vi.fn(() => {
          const p = createMockChildProcess()
          processes.push(p)
          return p
        }),
      })
      const supervisor = new ProcessSupervisor(config)

      // First start
      await supervisor.start()
      processes[0].emit('exit', 1, null)
      expect(supervisor.getState()).toBe('backoff')

      // First backoff: ~1000ms (base * 2^0)
      await vi.advanceTimersByTimeAsync(500)
      expect(supervisor.getState()).toBe('backoff') // Not yet
      await vi.advanceTimersByTimeAsync(700)
      // Should have restarted by now (1000 + up to 10% jitter = max 1100)
      expect(supervisor.getState()).not.toBe('backoff')

      // Second crash
      if (supervisor.getState() === 'running' || supervisor.getState() === 'starting') {
        processes[1]?.emit('exit', 1, null)
      }
      expect(supervisor.getState()).toBe('backoff')

      // Second backoff: ~2000ms (base * 2^1)
      await vi.advanceTimersByTimeAsync(1500)
      expect(supervisor.getState()).toBe('backoff') // Not yet at 1500ms
      await vi.advanceTimersByTimeAsync(1000)
      expect(supervisor.getState()).not.toBe('backoff')

      supervisor.destroy()
    })
  })

  describe('circuit breaker (FATAL)', () => {
    it('transitions to FATAL after MAX_RESTARTS crashes', async () => {
      const processes: ReturnType<typeof createMockChildProcess>[] = []
      let fatalReason: string | null = null
      const config = createConfig({
        spawn: vi.fn(() => {
          const p = createMockChildProcess()
          processes.push(p)
          return p
        }),
      })
      const supervisor = new ProcessSupervisor(config)
      supervisor.on('fatal', (reason: string) => {
        fatalReason = reason
      })

      await supervisor.start()

      // Crash MAX_RESTARTS (5) times
      for (let i = 0; i < 5; i++) {
        const proc = processes[processes.length - 1]
        proc.emit('exit', 1, null)

        if (supervisor.getState() === 'backoff') {
          // Advance past backoff to trigger restart
          await vi.advanceTimersByTimeAsync(120_000) // Well past max backoff
        }
      }

      expect(supervisor.getState()).toBe('fatal')
      expect(fatalReason).toBeTruthy()
      expect(fatalReason).toContain('test-process')

      supervisor.destroy()
    })

    it('FATAL -> start() resets counters and allows restart', async () => {
      const processes: ReturnType<typeof createMockChildProcess>[] = []
      const config = createConfig({
        spawn: vi.fn(() => {
          const p = createMockChildProcess()
          processes.push(p)
          return p
        }),
      })
      const supervisor = new ProcessSupervisor(config)

      await supervisor.start()

      // Drive to FATAL
      for (let i = 0; i < 5; i++) {
        processes[processes.length - 1].emit('exit', 1, null)
        if (supervisor.getState() === 'backoff') {
          await vi.advanceTimersByTimeAsync(120_000)
        }
      }
      expect(supervisor.getState()).toBe('fatal')

      // Restart from FATAL
      await supervisor.start()
      expect(supervisor.getState()).toBe('running')
      expect(supervisor.getRestartCount()).toBe(0)

      supervisor.destroy()
    })
  })

  describe('health counter reset', () => {
    it('resets restart count after HEALTH_RESET_AFTER_MS of healthy running', async () => {
      const proc1 = createMockChildProcess()
      const proc2 = createMockChildProcess()
      let spawnCount = 0
      const config = createConfig({
        spawn: vi.fn(() => {
          spawnCount++
          return spawnCount === 1 ? proc1 : proc2
        }),
      })
      const supervisor = new ProcessSupervisor(config)

      await supervisor.start()

      // Crash once to increment restartCount
      proc1.emit('exit', 1, null)
      await vi.advanceTimersByTimeAsync(2000) // past backoff
      expect(supervisor.getRestartCount()).toBe(1)

      // Stay healthy for HEALTH_RESET_AFTER_MS (300_000)
      await vi.advanceTimersByTimeAsync(300_000)
      expect(supervisor.getRestartCount()).toBe(0)

      supervisor.destroy()
    })
  })

  describe('stop()', () => {
    it('sends SIGTERM then SIGKILL after timeout', async () => {
      const config = createConfig()
      const supervisor = new ProcessSupervisor(config)

      await supervisor.start()
      expect(supervisor.getState()).toBe('running')

      const stopPromise = supervisor.stop()

      // SIGTERM should have been sent
      expect(config.mockProcess.kill).toHaveBeenCalledWith('SIGTERM')

      // Advance past PROCESS_KILL_TIMEOUT_MS (5000)
      await vi.advanceTimersByTimeAsync(5000)

      // SIGKILL should follow
      expect(config.mockProcess.kill).toHaveBeenCalledWith('SIGKILL')

      // Simulate process finally exiting
      config.mockProcess.emit('exit', null, 'SIGKILL')
      await vi.advanceTimersByTimeAsync(1000)

      await stopPromise
      expect(supervisor.getState()).toBe('stopped')

      supervisor.destroy()
    })

    it('transitions to STOPPED immediately if process exits on SIGTERM', async () => {
      const config = createConfig()
      const supervisor = new ProcessSupervisor(config)

      await supervisor.start()

      // Start stop, then immediately emit exit
      const stopPromise = supervisor.stop()
      config.mockProcess.emit('exit', 0, 'SIGTERM')

      await stopPromise
      expect(supervisor.getState()).toBe('stopped')

      supervisor.destroy()
    })

    it('during BACKOFF cancels the backoff timer', async () => {
      const proc1 = createMockChildProcess()
      const config = createConfig({
        spawn: vi.fn(() => proc1),
      })
      const supervisor = new ProcessSupervisor(config)

      await supervisor.start()
      proc1.emit('exit', 1, null)
      expect(supervisor.getState()).toBe('backoff')

      await supervisor.stop()
      expect(supervisor.getState()).toBe('stopped')

      // Advance time - should NOT attempt restart
      await vi.advanceTimersByTimeAsync(120_000)
      expect(supervisor.getState()).toBe('stopped')
      // spawn was called only once (the initial start)
      expect(config.spawn).toHaveBeenCalledOnce()

      supervisor.destroy()
    })
  })

  describe('liveness probe', () => {
    it('kills process after HEALTH_FAILURE_THRESHOLD consecutive failures', async () => {
      const failureEvents: number[] = []
      const config = createConfig({
        livenessProbe: vi.fn().mockResolvedValue(false),
      })
      const supervisor = new ProcessSupervisor(config)
      supervisor.on('health-check-failed', (count: number) => failureEvents.push(count))

      await supervisor.start()
      expect(supervisor.getState()).toBe('running')

      // Advance through 3 probe intervals (HEALTH_FAILURE_THRESHOLD = 3)
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(10_000) // HEALTH_PROBE_INTERVAL_MS
      }

      expect(failureEvents).toEqual([1, 2, 3])
      expect(config.mockProcess.kill).toHaveBeenCalledWith('SIGKILL')
      // Should have crashed and entered backoff
      expect(['crashed', 'backoff', 'fatal'].includes(supervisor.getState())).toBe(true)

      supervisor.destroy()
    })

    it('resets failure counter on success', async () => {
      let callCount = 0
      const config = createConfig({
        livenessProbe: vi.fn(async () => {
          callCount++
          // Fail first 2, then succeed, then fail again
          return callCount === 3
        }),
      })
      const supervisor = new ProcessSupervisor(config)
      const failureEvents: number[] = []
      supervisor.on('health-check-failed', (count: number) => failureEvents.push(count))

      await supervisor.start()

      // 2 failures
      await vi.advanceTimersByTimeAsync(10_000)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(failureEvents).toEqual([1, 2])

      // 1 success (resets counter)
      await vi.advanceTimersByTimeAsync(10_000)

      // Next failure should be back to 1
      await vi.advanceTimersByTimeAsync(10_000)
      expect(failureEvents).toEqual([1, 2, 1])

      supervisor.destroy()
    })
  })

  describe('PID file', () => {
    it('writes PID on start and cleans on stop', async () => {
      const fs = await import('fs')
      const config = createConfig({
        pidFilePath: '/tmp/test.pid',
      })
      const supervisor = new ProcessSupervisor(config)

      await supervisor.start()

      expect(fs.writeFileSync).toHaveBeenCalledWith('/tmp/test.pid', '12345', 'utf-8')

      // Make existsSync return true so cleanPidFile will call unlinkSync
      vi.mocked(fs.existsSync).mockReturnValue(true)

      const stopPromise = supervisor.stop()
      config.mockProcess.emit('exit', 0, 'SIGTERM')
      await stopPromise

      expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/test.pid')

      supervisor.destroy()
    })
  })

  describe('events', () => {
    it('emits state-change with old and new state', async () => {
      const transitions: [ProcessState, ProcessState][] = []
      const config = createConfig()
      const supervisor = new ProcessSupervisor(config)
      supervisor.on('state-change', (oldState: ProcessState, newState: ProcessState) => {
        transitions.push([oldState, newState])
      })

      await supervisor.start()

      expect(transitions).toEqual([
        ['stopped', 'starting'],
        ['starting', 'running'],
      ])

      supervisor.destroy()
    })
  })
})
