/**
 * Centralized logging system.
 * Provides log levels with production-safe defaults.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LoggerConfig {
  level: LogLevel
  enableDebugInProduction: boolean
}

const config: LoggerConfig = {
  level: (process.env.NODE_ENV === 'production' ? 'info' : 'debug') as LogLevel,
  enableDebugInProduction: false,
}

const logLevels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

function shouldLog(level: LogLevel): boolean {
  return logLevels[level] >= logLevels[config.level]
}

function formatMessage(level: LogLevel, tag: string, message: string): string {
  return `[${tag}] ${message}`
}

export const logger = {
  /**
   * Debug logs - only shown in development mode by default
   */
  debug(tag: string, message: string, ...args: any[]): void {
    if (shouldLog('debug')) {
      console.log(formatMessage('debug', tag, message), ...args)
    }
  },

  /**
   * Info logs - general informational messages
   */
  info(tag: string, message: string, ...args: any[]): void {
    if (shouldLog('info')) {
      console.log(formatMessage('info', tag, message), ...args)
    }
  },

  /**
   * Warning logs - potential issues
   */
  warn(tag: string, message: string, ...args: any[]): void {
    if (shouldLog('warn')) {
      console.warn(formatMessage('warn', tag, message), ...args)
    }
  },

  /**
   * Error logs - critical issues
   */
  error(tag: string, message: string, ...args: any[]): void {
    if (shouldLog('error')) {
      console.error(formatMessage('error', tag, message), ...args)
    }
  },

  /**
   * Configure logger behavior
   */
  configure(newConfig: Partial<LoggerConfig>): void {
    Object.assign(config, newConfig)
  },

  /**
   * Get current configuration
   */
  getConfig(): Readonly<LoggerConfig> {
    return { ...config }
  },
}
