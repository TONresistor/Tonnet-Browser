/**
 * Validation utilities for spawn arguments.
 * Shared between proxy and storage managers.
 */

/**
 * Validates a port number for spawned processes.
 * Returns default if port is invalid (outside 1024-65535 range).
 */
export function validatePort(port: number, defaultPort = 8080): number {
  if (typeof port !== 'number' || port < 1024 || port > 65535) {
    console.warn(`[Validators] Invalid port ${port}, using default ${defaultPort}`)
    return defaultPort
  }
  return port
}

/**
 * Validates verbosity level for spawned processes.
 * Returns default if verbosity is invalid (outside 0-5 range).
 */
export function validateVerbosity(verbosity: number, defaultVerbosity = 2): number {
  if (typeof verbosity !== 'number' || verbosity < 0 || verbosity > 5) {
    return defaultVerbosity
  }
  return verbosity
}
