/**
 * Shared child-process teardown for the proxy, bridge and storage managers (OPP-36).
 */
import { ChildProcess } from 'child_process'
import { untrackDaemon, forceKillTree } from '../daemon-registry'

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
    // Windows: SIGTERM is already an immediate, single-PID TerminateProcess (no
    // graceful delivery), and the Go daemons may have spawned children. Kill the
    // whole tree with taskkill so nothing is left holding the ports.
    if (process.platform === 'win32') {
      if (proc.pid != null) forceKillTree(proc.pid)
      finish()
      return
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
