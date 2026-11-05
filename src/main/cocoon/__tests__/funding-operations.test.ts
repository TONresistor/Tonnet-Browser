import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
vi.mock('electron', () => ({
  app: {
    getPath: () => {
      throw new Error('An isolated directory is required')
    },
  },
}))
import { StakeCacheStore } from '../stake-cache'
const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
describe('durable Cocoon funding references', () => {
  it('coalesces concurrent reservations and preserves the identifier across restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cocoon-funding-'))
    directories.push(directory)
    const first = new StakeCacheStore(directory)
    const [left, right] = await Promise.all([
      first.reserveFunding('activation:node', '20', 'source-a'),
      first.reserveFunding('activation:node', '20', 'source-a'),
    ])
    expect(left).toBe(right)
    const reopened = new StakeCacheStore(directory)
    expect(await reopened.reserveFunding('activation:node', '20', 'source-a')).toBe(left)
    await expect(reopened.reserveFunding('activation:node', '20', 'source-b')).rejects.toThrow('another native wallet')
    await expect(reopened.reserveFunding('activation:node', '21', 'source-a')).rejects.toThrow('amount changed')
  })
})
