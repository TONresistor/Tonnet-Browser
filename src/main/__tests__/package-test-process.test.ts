import { expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPackageTestProcess } from '../../../scripts/run-package-test-process.mjs'

it.each([
  '[Unhandled Promise Rejection] Error: broken overlay cleanup',
  "Error: No handler registered for 'overlay:hide'",
])('rejects an unhandled application failure even when the process exits zero: %s', async (message) => {
  await expect(
    runPackageTestProcess(process.execPath, ['-e', `console.error(${JSON.stringify(message)})`])
  ).rejects.toThrow('Unhandled application/IPC failure')
})
it('accepts a clean exit with known OS diagnostic noise', async () => {
  await expect(
    runPackageTestProcess(process.execPath, [
      '-e',
      "console.error('ERROR:base/process/process_mac.cc task_policy_set invalid argument')",
    ])
  ).resolves.toBeUndefined()
})
it('rejects a nonzero process exit', async () => {
  await expect(runPackageTestProcess(process.execPath, ['-e', 'process.exit(2)'])).rejects.toThrow('exit 2')
})

it('kills descendants holding output pipes open before rejecting a timeout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tonnet-process-timeout-'))
  const pidFile = join(directory, 'descendant.pid')
  let deadline: ReturnType<typeof setTimeout> | undefined
  try {
    const descendant = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`
    const parent = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'inherit' }); setInterval(() => {}, 1000)`
    await expect(
      Promise.race([
        runPackageTestProcess(process.execPath, ['-e', parent], { timeoutMs: 1000 }),
        new Promise((_, reject) => {
          deadline = setTimeout(() => reject(new Error('Descendant kept the package output open')), 4000)
        }),
      ])
    ).rejects.toThrow('exceeded 1000 ms')
    // A successfully started descendant held the inherited pipes until the runner killed it.
    expect(Number(await readFile(pidFile, 'utf8'))).toBeGreaterThan(0)
  } finally {
    clearTimeout(deadline)
    const pid = Number(await readFile(pidFile, 'utf8').catch(() => ''))
    if (pid > 0) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // Normally already stopped by the runner; clean up this fixture on failure too.
      }
    }
    await rm(directory, { recursive: true, force: true })
  }
})
