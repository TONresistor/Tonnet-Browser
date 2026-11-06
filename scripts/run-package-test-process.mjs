import { spawn } from 'node:child_process'
import { basename } from 'node:path'

export async function runPackageTestProcess(
  command,
  args,
  { streamOutput = false, timeoutMs = 360_000, ...options } = {}
) {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ASAR
  return new Promise((resolveExit, reject) => {
    // Own a process group so a timed-out package cannot leave native helpers behind.
    const child = spawn(command, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
      detached: process.platform !== 'win32',
    })
    let output = ''
    let unhandled = false
    const recordOutput = (chunk) => {
      output = (output + chunk.toString()).slice(-20_000)
      if (/\[Unhandled Promise Rejection\]|No handler registered for/.test(output)) unhandled = true
      if (streamOutput) process.stdout.write(chunk)
    }
    child.stdout.on('data', recordOutput)
    child.stderr.on('data', recordOutput)
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
        killer.on('error', () => child.kill())
      } else if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch (error) {
          if (error.code !== 'ESRCH') child.kill('SIGKILL')
        }
      }
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('close', (code, signal) => {
      clearTimeout(timeout)
      if (timedOut) reject(new Error(`${basename(command)} exceeded ${timeoutMs} ms\n${output}`))
      else if (unhandled) reject(new Error(`Unhandled application/IPC failure despite exit ${code}\n${output}`))
      else if (code === 0) resolveExit()
      else reject(new Error(`${basename(command)} failed (exit ${code}, signal ${signal})\n${output}`))
    })
  })
}
