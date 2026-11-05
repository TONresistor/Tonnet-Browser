export interface WalletLogger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
  event(...args: unknown[]): void
  status(...args: unknown[]): void
}
const ignore = (..._args: unknown[]): void => {}
export function createLogger(_scope: string): WalletLogger {
  return { debug: ignore, info: ignore, warn: ignore, error: ignore, event: ignore, status: ignore }
}
