/**
 * Test setup utilities
 * Import and call these in beforeEach/afterEach
 */
import { vi, beforeEach, afterEach } from 'vitest'

// ============================================
// TIMER HELPERS
// ============================================

/**
 * Setup fake timers for async tests
 * Call in describe() block, not in individual tests
 */
export const useFakeTimers = () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })
}

/**
 * Advance timers and flush promises
 */
export const advanceTime = async (ms: number) => {
  vi.advanceTimersByTime(ms)
  await vi.runAllTimersAsync()
}

/**
 * Wait for next tick (useful for EventEmitter)
 */
export const nextTick = () => new Promise((resolve) => setImmediate(resolve))

// ============================================
// MOCK HELPERS
// ============================================

/**
 * Clear all mocks between tests
 */
export const useClearMocks = () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
}

/**
 * Reset all mocks (clears calls AND implementations)
 */
export const useResetMocks = () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })
}

// ============================================
// COMMON SETUP COMBINATIONS
// ============================================

/**
 * Standard setup for most tests: clear mocks + fake timers
 */
export const useStandardSetup = () => {
  useClearMocks()
  useFakeTimers()
}

// ============================================
// ASSERTION HELPERS
// ============================================

/**
 * Assert a function was called with specific partial args
 */
export const expectCalledWithPartial = (
  mockFn: ReturnType<typeof vi.fn>,
  partial: Record<string, unknown>
) => {
  expect(mockFn).toHaveBeenCalled()
  const lastCall = mockFn.mock.calls[mockFn.mock.calls.length - 1]
  expect(lastCall[0]).toMatchObject(partial)
}

/**
 * Assert event was emitted on EventEmitter mock
 */
export const expectEventEmitted = (
  emitter: { emit: ReturnType<typeof vi.fn> },
  eventName: string,
  data?: unknown
) => {
  expect(emitter.emit).toHaveBeenCalledWith(eventName, data !== undefined ? data : expect.anything())
}
