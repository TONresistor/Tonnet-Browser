/**
 * Shared child-process teardown for the proxy, bridge and storage managers (OPP-36).
 */
import { ChildProcess } from 'child_process'
import { untrackDaemon } from '../daemon-registry'

/**
 * Gracefully stop a child process: detach listeners, send SIGTERM, and escalate
 * to SIGKILL after 5s if it has not exited. Resolves once the process is gone.
 */
export function killChildProcess(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    proc.stdout?.removeAllListeners()
    proc.stderr?.removeAllListeners()
    proc.removeAllListeners()
    const finish = () => {
      untrackDaemon(proc.pid)
      resolve()
    }
    const forceKill = setTimeout(() => {
      try {
        proc.kill('SIGKILL')
      } catch {
        /* process already dead */
      }
      finish()
    }, 5000)
    proc.once('exit', () => {
      clearTimeout(forceKill)
      finish()
    })
    proc.kill('SIGTERM')
  })
}
