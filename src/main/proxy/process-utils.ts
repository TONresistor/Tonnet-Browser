/**
 * Shared child-process teardown for the proxy + bridge managers (OPP-36).
 */
import { ChildProcess } from 'child_process'

/**
 * Gracefully stop a child process: detach listeners, send SIGTERM, and escalate
 * to SIGKILL after 5s if it has not exited. Resolves once the process is gone.
 */
export function killChildProcess(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    proc.stdout?.removeAllListeners()
    proc.stderr?.removeAllListeners()
    proc.removeAllListeners()
    const forceKill = setTimeout(() => {
      try {
        proc.kill('SIGKILL')
      } catch {
        /* process already dead */
      }
      resolve()
    }, 5000)
    proc.once('exit', () => {
      clearTimeout(forceKill)
      resolve()
    })
    proc.kill('SIGTERM')
  })
}
