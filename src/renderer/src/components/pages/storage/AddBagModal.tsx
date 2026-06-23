import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Plus, X } from 'lucide-react'
import { createLogger } from '@/logger'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { ActionButton } from '@/components/ui/ios/ActionButton'

const log = createLogger('storage')

// Regex to validate TON Storage Bag ID (64 hex characters)
const BAG_ID_REGEX = /^[a-fA-F0-9]{64}$/

interface AddBagModalProps {
  isOpen: boolean
  onClose: () => void
  onBagAdded: () => void
}

export function AddBagModal({ isOpen, onClose, onBagAdded }: AddBagModalProps) {
  const { t } = useTranslation('pages')
  const [newBagId, setNewBagId] = useState('')
  const [bagIdError, setBagIdError] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const addModalRef = useRef<HTMLDivElement>(null)

  useFocusTrap(addModalRef, isOpen)

  const handleClose = () => {
    setNewBagId('')
    setBagIdError('')
    onClose()
  }

  const handleAddBag = async () => {
    const trimmedId = newBagId.trim()
    setBagIdError('')

    if (!trimmedId) return

    if (!BAG_ID_REGEX.test(trimmedId)) {
      setBagIdError(t('storage.errors.invalidBagId'))
      return
    }

    setIsAdding(true)
    try {
      const result = await window.electron.storage.addBag(trimmedId)
      if (result.success) {
        onBagAdded()
        setNewBagId('')
        setBagIdError('')
        onClose()
      } else if (result.error) {
        setBagIdError(result.error)
      }
    } catch (err) {
      log.error('Failed to add bag:', err)
      setBagIdError(t('storage.errors.addFailed'))
    } finally {
      setIsAdding(false)
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={handleClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') handleClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-bag-title"
    >
      <div
        ref={addModalRef}
        className="relative w-full max-w-md overflow-hidden rounded-panel border border-border-subtle bg-elevation-1 p-5 shadow-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={handleClose}
          aria-label={t('storage.addModal.cancel')}
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <h3 id="add-bag-title" className="pr-8 text-[17px] font-semibold text-foreground">
          {t('storage.addModal.title')}
        </h3>
        <p className="mt-1 mb-4 text-[13px] text-muted-foreground">{t('storage.addModal.bagIdDescription')}</p>

        <div className="mb-5">
          <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t('storage.addModal.bagIdLabel')}
          </label>
          <input
            type="text"
            value={newBagId}
            onChange={(e) => {
              setNewBagId(e.target.value)
              setBagIdError('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newBagId.trim() && !isAdding) {
                handleAddBag()
              }
            }}
            placeholder={t('storage.addModal.bagIdPlaceholder')}
            className={`w-full rounded-card bg-surface px-3 py-2.5 font-mono text-sm text-foreground transition-colors placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring ${bagIdError ? 'ring-2 ring-destructive' : ''}`}
            autoFocus
          />
          {bagIdError && <p className="mt-2 text-xs text-destructive">{bagIdError}</p>}
        </div>

        <div className="flex gap-3">
          <ActionButton variant="gray" onClick={handleClose} className="flex-1">
            {t('storage.addModal.cancel')}
          </ActionButton>
          <ActionButton
            variant="filled"
            onClick={handleAddBag}
            disabled={!newBagId.trim() || isAdding}
            className="flex-1"
            icon={isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          >
            {isAdding ? t('storage.addModal.adding') : t('storage.addModal.add')}
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
