/**
 * Strips ANSI SGR escape codes (color/style) from process output.
 * Shared by the proxy and bridge log parsers so the control-regex
 * exception lives in exactly one place.
 */

// eslint-disable-next-line no-control-regex
const ANSI_SGR = /\x1b\[[0-9;]*m/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_SGR, '')
}
