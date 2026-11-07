import { describe, expect, it, vi } from 'vitest'
import { ElectronTonConnectApproval } from '../electron-approval'
import { Window } from 'happy-dom'
import { runInNewContext } from 'node:vm'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function unlockPrompt(unlock = vi.fn(async (_password: string) => false), signal?: AbortSignal) {
  let action!: (type: string, data?: unknown) => void
  const overlay = {
    show: vi.fn((_id, _bounds, _content, callback) => {
      action = callback
      return true
    }),
    hide: vi.fn(),
  }
  const window = { getContentBounds: () => ({ width: 800, height: 600 }) }
  const approval = new ElectronTonConnectApproval(overlay as never, () => window as never)
  const result = approval.requestUnlock('app.ton', unlock, signal)
  return { overlay, unlock, result, action: (type: string, data?: unknown) => action(type, data) }
}

describe('ElectronTonConnectApproval', () => {
  it('fails closed when no application window exists', async () => {
    const overlay = { show: vi.fn(), hide: vi.fn() }
    const approval = new ElectronTonConnectApproval(overlay as never, () => null)
    await expect(approval.request({ type: 'approval' })).resolves.toBe(false)
    expect(overlay.show).not.toHaveBeenCalled()
  })

  it('fails closed when the overlay manager is detached', async () => {
    const overlay = { show: vi.fn(() => false), hide: vi.fn() }
    const window = { getContentBounds: () => ({ width: 800, height: 600 }) }
    const approval = new ElectronTonConnectApproval(overlay as never, () => window as never)

    await expect(approval.request({ type: 'approval' })).resolves.toBe(false)
  })

  it('maps only the approve action to consent and owns unique overlay ids', async () => {
    let callback: ((action: string) => void) | undefined
    const overlay = {
      show: vi.fn((_id, _bounds, _content, action) => {
        callback = action
        return true
      }),
      hide: vi.fn(),
    }
    const window = { getContentBounds: () => ({ width: 800, height: 600 }) }
    const approval = new ElectronTonConnectApproval(overlay as never, () => window as never)
    const result = approval.request({ type: 'approval', title: 'Connect' })
    callback?.('approve')

    await expect(result).resolves.toBe(true)
    expect(overlay.show).toHaveBeenCalledWith(
      'tonconnect-approve-1',
      { x: 0, y: 0, width: 800, height: 600 },
      { type: 'approval', title: 'Connect' },
      expect.any(Function),
      { autoDismiss: false }
    )
    expect(overlay.hide).toHaveBeenCalledWith('tonconnect-approve-1')
    for (const action of ['deny', 'cancel', 'unexpected']) {
      const rejected = approval.request({ type: 'approval', title: 'Connect' })
      callback?.(action)
      await expect(rejected).resolves.toBe(false)
    }
    const ids = overlay.show.mock.calls.map(([id]) => id)
    expect(new Set(ids).size).toBe(4)
    expect(overlay.hide.mock.calls.map(([id]) => id)).toEqual(ids)
  })

  it('closes a revoked approval and ignores a late approve action', async () => {
    let callback: ((action: string) => void) | undefined
    const overlay = {
      show: vi.fn((_id, _bounds, _content, action) => {
        callback = action
        return true
      }),
      hide: vi.fn(),
    }
    const window = { getContentBounds: () => ({ width: 800, height: 600 }) }
    const approval = new ElectronTonConnectApproval(overlay as never, () => window as never)
    const controller = new AbortController()
    const result = approval.request({ type: 'approval' }, controller.signal)
    controller.abort()
    await expect(result).resolves.toBe(false)
    callback?.('approve')
    expect(overlay.hide).toHaveBeenCalledOnce()
    await expect(approval.request({ type: 'approval' }, controller.signal)).resolves.toBe(false)
    expect(overlay.show).toHaveBeenCalledOnce()
  })

  it('retries an invalid password in the native popup and never echoes it into content', async () => {
    const unlock = vi.fn(async (password: string) => password === 'correct-fixture-password')
    const s = unlockPrompt(unlock)
    expect(s.overlay.show).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ title: 'Unlock wallet', passwordLabel: 'Wallet password', domain: 'app.ton' }),
      expect.any(Function),
      { autoDismiss: false, focus: true, persistentActions: true }
    )
    s.action('approve', { password: 'wrong-fixture-password' })
    await vi.waitFor(() => expect(s.overlay.show).toHaveBeenCalledTimes(2))
    expect(s.overlay.hide).not.toHaveBeenCalled()
    expect(s.overlay.show.mock.calls[1][2]).toMatchObject({ warning: expect.stringContaining('Check your password') })
    s.action('approve', { password: 'correct-fixture-password' })
    await expect(s.result).resolves.toBe(true)
    expect(s.overlay.hide).toHaveBeenCalledOnce()
    expect(JSON.stringify(s.overlay.show.mock.calls)).not.toContain('fixture-password')
  })

  it('cancels without checking a password', async () => {
    const s = unlockPrompt()
    s.action('deny')
    await expect(s.result).resolves.toBe(false)
    expect(s.unlock).not.toHaveBeenCalled()
  })

  it('does not start password verification after an immediate cancellation', async () => {
    const s = unlockPrompt()
    s.action('approve', { password: 'fixture-password' })
    s.action('deny')
    await expect(s.result).resolves.toBe(false)
    expect(s.unlock).not.toHaveBeenCalled()
  })

  it('ignores a late unlock after cancellation', async () => {
    let finish!: (value: boolean) => void
    const unlock = vi.fn(
      (_password: string) =>
        new Promise<boolean>((resolve) => {
          finish = resolve
        })
    )
    const controller = new AbortController()
    const s = unlockPrompt(unlock, controller.signal)
    s.action('approve', { password: 'fixture-password' })
    await vi.waitFor(() => expect(unlock).toHaveBeenCalledOnce())
    controller.abort()
    await expect(s.result).resolves.toBe(false)
    finish(true)
    await Promise.resolve()
    expect(s.overlay.show).toHaveBeenCalledOnce()
    expect(s.overlay.hide).toHaveBeenCalledOnce()
  })

  it.each([{}, { password: '' }, { password: 'x'.repeat(257) }])('rejects malformed unlock input', async (data) => {
    const s = unlockPrompt()
    s.action('approve', data)
    expect(s.unlock).not.toHaveBeenCalled()
    s.action('deny')
    await expect(s.result).resolves.toBe(false)
  })

  it('bounds password attempts to five per minute', async () => {
    const s = unlockPrompt()
    for (let attempt = 0; attempt < 5; attempt++) {
      s.action('approve', { password: 'fixture-password' })
      await vi.waitFor(() => expect(s.overlay.show).toHaveBeenCalledTimes(attempt + 2))
    }
    s.action('approve', { password: 'fixture-password' })
    expect(s.unlock).toHaveBeenCalledTimes(5)
    expect(s.overlay.show.mock.calls.at(-1)?.[2]).toMatchObject({
      warning: expect.stringContaining('Too many attempts'),
    })
    s.action('deny')
    await expect(s.result).resolves.toBe(false)
  })
})

describe('TON Connect native password field', () => {
  it.each(['Enter', 'Escape'])('masks the password and clears it before dispatching %s', (key) => {
    const window = new Window()
    const document = window.document
    document.body.innerHTML = '<div id="root"></div>'
    let render!: (content: unknown) => void
    const bridge = {
      onContent: (callback: typeof render) => {
        render = callback
      },
      onTheme: vi.fn(),
      sendAction: vi.fn(),
    }
    Object.assign(window, { overlayBridge: bridge })
    runInNewContext(readFileSync(resolve('resources/overlay/overlay.js'), 'utf8'), { window, document })
    const content = {
      type: 'approval',
      title: 'Unlock wallet',
      iconLock: true,
      domain: 'fixture.ton',
      passwordLabel: 'Wallet password',
      actions: [{ id: 'approve', label: 'Unlock' }],
    }
    render(content)
    const input = document.querySelector('input')!
    expect(input.type).toBe('password')
    expect(input.placeholder).toBe('Wallet password')
    expect(document.querySelector('.form-label')).toBeNull()
    expect(document.querySelector('.tc-card')!.firstElementChild).toBe(document.querySelector('.tc-domain'))
    expect(document.querySelector('.tc-icon-fallback svg')?.getAttribute('viewBox')).toBe('0 0 28 28')
    expect(input.autocomplete).toBe('current-password')
    expect(document.activeElement).toBe(input)
    input.value = 'fixture-password'
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }))
    expect(bridge.sendAction).toHaveBeenCalledExactlyOnceWith(
      key === 'Enter' ? 'approve' : 'dismiss',
      key === 'Enter' ? { password: 'fixture-password' } : {}
    )
    expect(input.value).toBe('')
    expect(input.disabled).toBe(true)
    render(content)
    expect(document.querySelector('input')!.value).toBe('')
    render(null)
    expect(document.querySelector('input')).toBeNull()
    window.close()
  })
})
