// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatPage from '../ChatPage'

vi.mock('electron-log/renderer', () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}))

const listeners = new Map<string, Set<(...args: any[]) => void>>()

const mockElectron = {
  chat: {
    connect: vi.fn().mockResolvedValue({ connected: true, room: 'tonnet:groupchat', via: 'dht' }),
    send: vi.fn(),
    dmSend: vi.fn(),
    createRoom: vi.fn(),
    disconnect: vi.fn().mockResolvedValue({ disconnected: true }),
    identity: vi.fn().mockResolvedValue({
      deviceKey: 'a'.repeat(64),
      linked: false,
      declined: false,
      walletReady: false,
    }),
    linkIdentity: vi.fn(),
    claimDomain: vi.fn(),
    clearDomain: vi.fn(),
    detectDomains: vi.fn(),
    resetIdentity: vi.fn(),
  },
  settings: {
    get: vi.fn().mockImplementation((category: string) => {
      if (category === 'messenger') return Promise.resolve({ attachWalletIdentity: false, networkEnabled: true })
      return Promise.resolve({})
    }),
    set: vi.fn().mockResolvedValue({ success: true }),
  },
  on: vi.fn((channel: string, callback: (...args: any[]) => void) => {
    const set = listeners.get(channel) ?? new Set()
    set.add(callback)
    listeners.set(channel, set)
    return () => {
      set.delete(callback)
    }
  }),
}

describe('ChatPage', () => {
  let container: HTMLDivElement
  let root: Root | null

  beforeEach(() => {
    vi.clearAllMocks()
    listeners.clear()
    localStorage.clear()
    localStorage.setItem('groupchat.rooms', JSON.stringify([{ room: 'tonnet:groupchat' }]))
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: mockElectron,
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount()
      })
      root = null
    }
    container.remove()
  })

  it('disconnects the active chat session when unmounted', async () => {
    await act(async () => {
      root?.render(<ChatPage />)
    })

    const row = container.querySelector('[role="option"]') as HTMLElement
    expect(row).toBeTruthy()

    await act(async () => {
      row.click()
    })

    expect(mockElectron.chat.connect).toHaveBeenCalledWith('tonnet:groupchat', undefined)
    expect(container.textContent).toContain('connected')
    mockElectron.chat.disconnect.mockClear()

    await act(async () => {
      root?.unmount()
    })
    root = null

    expect(mockElectron.chat.disconnect).toHaveBeenCalledTimes(1)
  })

  it('shows a connection error when chat.connect rejects', async () => {
    mockElectron.chat.connect.mockRejectedValueOnce(new Error('Bridge not connected'))

    await act(async () => {
      root?.render(<ChatPage />)
    })

    const row = container.querySelector('[role="option"]') as HTMLElement
    await act(async () => {
      row.click()
    })

    expect(container.textContent).toContain('Bridge not connected')
  })
})
