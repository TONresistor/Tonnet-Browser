import log from 'electron-log'

export default log

export function createLogger(scope: string) {
  return log.scope(scope)
}
