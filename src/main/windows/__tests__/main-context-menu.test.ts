import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  writeText: vi.fn<() => Promise<void>>(),
  logError: vi.fn(),
}))

vi.mock('electron', () => ({ BrowserWindow: class {}, clipboard: { writeText: mocks.writeText } }))
vi.mock('../../../shared/logger', () => ({
  createLogger: () => ({ error: mocks.logError }),
}))

import { setupMainContextMenu } from '../main-context-menu'

it('dismisses the context menu and handles an asynchronous clipboard failure', async () => {
  const error = new Error('Clipboard unavailable')
  mocks.writeText.mockRejectedValueOnce(error)
  const webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false })
  const window = { webContents, getContentSize: () => [800, 600] }
  const overlays = { show: vi.fn(), hide: vi.fn() }
  const registration = setupMainContextMenu(window as never, overlays as never)
  webContents.emit('context-menu', {}, { x: 20, y: 20, linkURL: 'http://whitepaper.ton' })
  const onAction = overlays.show.mock.calls[0][3]

  onAction('copy-link', { url: 'http://whitepaper.ton' })

  expect(mocks.writeText).toHaveBeenCalledWith('http://whitepaper.ton')
  expect(overlays.hide).toHaveBeenCalledWith('main-context-menu')
  await vi.waitFor(() => expect(mocks.logError).toHaveBeenCalledWith('Failed to copy link:', error))
  registration.dispose()
})
