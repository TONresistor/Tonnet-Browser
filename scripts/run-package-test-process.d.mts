import type { SpawnOptionsWithoutStdio } from 'node:child_process'
export function runPackageTestProcess(
  command: string,
  args: string[],
  options?: SpawnOptionsWithoutStdio & { streamOutput?: boolean; timeoutMs?: number }
): Promise<void>
