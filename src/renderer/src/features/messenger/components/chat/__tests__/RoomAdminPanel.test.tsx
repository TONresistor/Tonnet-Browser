// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RoomAdminPanel } from '../RoomAdminPanel'

const moderator = 'M'.repeat(43)
const roomState = {
  roomId: 'R'.repeat(43),
  name: 'Community',
  description: 'Description',
  writePolicy: 'everyone' as const,
  admins: [],
  moderators: [moderator],
  pinnedMessages: [],
  revisionSeqno: 0,
  latestSeqno: 0,
}

describe('Room settings save', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it.each([true, false])(
    'stages changes and saves sequentially when the first operation succeeds=%s',
    async (success) => {
      const mutate = vi.fn().mockResolvedValue(success)
      await act(async () =>
        root.render(
          <RoomAdminPanel
            id="settings"
            open
            roomState={roomState}
            disabled={false}
            onClose={() => {}}
            onMutate={mutate}
          />
        )
      )
      const save = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Save')!
      expect(save.closest('header')).not.toBeNull()
      expect(save.disabled).toBe(true)
      act(() => container.querySelector<HTMLInputElement>('input[value="admins"]')!.click())
      act(() =>
        container.querySelector<HTMLButtonElement>(`button[aria-label="Remove moderator ${moderator}"]`)!.click()
      )
      expect(mutate).not.toHaveBeenCalled()
      expect(save.disabled).toBe(false)
      await act(async () => save.click())
      expect(mutate.mock.calls).toEqual(
        success
          ? [
              [{ action: 'write-policy', anyoneCanWrite: false }],
              [{ action: 'moderator-revoke', subjectKey: moderator }],
            ]
          : [[{ action: 'write-policy', anyoneCanWrite: false }]]
      )
    }
  )
})
