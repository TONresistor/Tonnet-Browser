import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { createLogger } from '@/logger'
import { useFocusTrap } from '@/hooks/useFocusTrap'

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
        className="rounded-[14px] p-6 w-full max-w-md mx-4 shadow-2xl"
        style={{
          background: 'rgba(20, 20, 22, 0.85)',
          backdropFilter: 'blur(24px) saturate(1.6)',
          WebkitBackdropFilter: 'blur(24px) saturate(1.6)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          boxShadow: '0 8px 40px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.12)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 id="add-bag-title" className="text-foreground font-semibold text-lg">
            {t('storage.addModal.title')}
          </h3>
          <button type="button" onClick={handleClose} className="text-muted-foreground hover:text-foreground p-1">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-muted-foreground text-sm mb-4">{t('storage.addModal.bagIdDescription')}</p>

        <div className="mb-4">
          <label className="block text-muted-foreground text-xs uppercase tracking-wider mb-2">
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
            className={`w-full px-3 py-2 bg-surface-hover border rounded-full text-foreground placeholder:text-muted-foreground/50 font-mono text-sm focus:outline-none focus:border-primary transition-colors ${bagIdError ? 'border-destructive' : 'border-border-medium'}`}
            autoFocus
          />
          {bagIdError && <p className="mt-2 text-destructive text-xs">{bagIdError}</p>}
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleClose}
            className="flex-1 py-2.5 rounded-full text-sm font-medium text-muted-foreground transition-all duration-200 hover:text-foreground bg-surface-hover backdrop-blur-[10px] border border-border-medium"
          >
            {t('storage.addModal.cancel')}
          </button>
          <button
            type="button"
            onClick={handleAddBag}
            disabled={!newBagId.trim() || isAdding}
            className="flex-1 py-2.5 rounded-full text-sm font-medium transition-all duration-200 hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 bg-primary/90 backdrop-blur-[10px] text-primary-foreground shadow-[0_4px_16px_hsl(var(--primary)/0.4),inset_0_1px_0_hsl(var(--foreground)/0.2)]"
          >
            {isAdding ? t('storage.addModal.adding') : t('storage.addModal.add')}
          </button>
        </div>
      </div>
    </div>
  )
}
