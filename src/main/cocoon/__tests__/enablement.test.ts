import { beforeEach, expect, it, vi } from 'vitest'
import { CocoonManager } from '../manager'
import { autostartCocoonIfEnabled } from '../autostart'

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(async () => {}),
  copyFile: vi.fn(async () => {}),
  getSetting: vi.fn(() => ({ enabled: true, autostart: true })),
  loadWallet: vi.fn(async () => ({ setupCompletedAt: 1, ownerAddress: 'test-owner', nodeSecretBase64: 'test-key' })),
}))
vi.mock('../../settings', () => ({ getSetting: mocks.getSetting }))
vi.mock('../wallet', () => ({ loadCocoonWallet: mocks.loadWallet }))
vi.mock('../lifecycle', () => ({ COCOON_ROOT_MAINNET: 'test-root' }))
vi.mock('../platform', () => ({ checkCocoonAvailability: () => ({ available: true }) }))
vi.mock('../paths', () => ({
  getCocoonBinaryPath: () => 'test-runner',
  getTonConfigPath: () => 'test-config',
  getClientConfigTemplatePath: () => 'test-template',
}))
vi.mock('fs/promises', () => ({
  mkdtemp: async () => '/tmp/test-cocoon',
  chmod: async () => {},
  readFile: async () => '{}',
  writeFile: async () => {},
  copyFile: mocks.copyFile,
  rm: async () => {},
}))
vi.mock('../../native-process/supervisor', () => ({
  NativeProcessSupervisor: class {
    start = mocks.start
    stop = mocks.stop
    async waitForReady() {}
  },
}))
const config = { ownerAddress: 'test-owner', nodeWalletKeyBase64: 'test-key', rootContractAddress: 'test-root' }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSetting.mockReturnValue({ enabled: true, autostart: true })
})
it('skips autostart when disabled even if autostart was enabled before', async () => {
  mocks.getSetting.mockReturnValue({ enabled: false, autostart: true })
  await autostartCocoonIfEnabled(new CocoonManager(false))
  expect(mocks.loadWallet).not.toHaveBeenCalled()
  expect(mocks.start).not.toHaveBeenCalled()
})
it('stops a running service and blocks starts until re-enabled', async () => {
  const manager = new CocoonManager()
  await manager.start(config)
  expect(manager.getState().kind).toBe('ready')
  await manager.setEnabled(false)
  expect(manager.getState().kind).toBe('stopped')
  expect(mocks.stop).toHaveBeenCalledOnce()
  await expect(manager.start(config)).rejects.toThrow('disabled')
  expect(mocks.start).toHaveBeenCalledOnce()
  await manager.setEnabled(true)
  expect(mocks.start).toHaveBeenCalledOnce()
  await manager.start(config)
  expect(mocks.start).toHaveBeenCalledTimes(2)
})
it('does not spawn a runner if disabled while its startup files are being prepared', async () => {
  let finish!: () => void
  mocks.copyFile.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  const manager = new CocoonManager()
  const starting = manager.start(config)
  const failure = expect(starting).rejects.toThrow('disabled')
  await vi.waitFor(() => expect(mocks.copyFile).toHaveBeenCalled())
  await manager.setEnabled(false)
  finish()
  await failure
  expect(mocks.start).not.toHaveBeenCalled()
  expect(manager.getState().kind).toBe('stopped')
})
