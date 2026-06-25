import { useEffect, type RefObject, type MutableRefObject } from 'react'

/**
 * Imperative handle a settings section publishes to the parent SettingsPage so
 * the global Save/Discard bar can drive it.
 */
export interface SectionHandle {
  save: () => Promise<void>
  discard: () => void
  hasChanges: boolean
}

/**
 * Wires the two boilerplate effects every settings section in the global
 * Save/Discard flow repeats verbatim:
 *   1. notify the parent of the current dirty state, and
 *   2. publish the imperative {save, discard, hasChanges} handle on sectionRef.
 *
 * The section keeps full ownership of its own draft/saved state and just passes
 * the derived handle here.
 */
export function useSectionHandle<H extends SectionHandle>(
  sectionRef: RefObject<H | null> | undefined,
  handle: H,
  onDirtyChange?: (dirty: boolean) => void
): void {
  const { save, discard, hasChanges } = handle

  useEffect(() => {
    onDirtyChange?.(hasChanges)
  }, [hasChanges, onDirtyChange])

  useEffect(() => {
    if (sectionRef) {
      ;(sectionRef as MutableRefObject<SectionHandle | null>).current = { save, discard, hasChanges }
    }
  }, [sectionRef, save, discard, hasChanges])
}
