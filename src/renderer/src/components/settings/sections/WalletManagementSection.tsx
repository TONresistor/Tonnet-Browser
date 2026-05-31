import { errorMessage } from '@shared/errors'
import { useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { UI_COPY_FEEDBACK_MS } from '@shared/constants'
import { LoaderCircle, Eye, EyeOff, Upload, KeyRound, Copy, Check, AlertTriangle, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWalletStore } from '@/stores/wallet'
import { useOverlay } from '@/hooks/useOverlay'
import { cn } from '@/lib/utils'

const MNEMONIC_CLEAR_TIMEOUT = 60_000

export function WalletManagementSection() {
  const { t } = useTranslation('wallet')
  const { isCreated, importWallet, exportMnemonic, deleteWallet, isLoading } = useWalletStore()
  const [words, setWords] = useState<string[] | null>(null)
  const [isRevealed, setIsRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportLoading, setExportLoading] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importInput, setImportInput] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)

  const deleteOverlayHideRef = useRef<(() => void) | null>(null)

  const handleDeleteAction = useCallback(
    async (actionType: string) => {
      deleteOverlayHideRef.current?.()
      if (actionType === 'confirm-delete') {
        await deleteWallet()
      }
    },
    [deleteWallet]
  )

  const deleteOverlay = useOverlay('wallet-delete-confirm', handleDeleteAction)
  deleteOverlayHideRef.current = deleteOverlay.hide

  const showDeleteOverlay = useCallback(() => {
    const w = 380
    const h = 280
    const x = Math.round((window.innerWidth - w) / 2)
    const y = Math.max(8, Math.round((window.innerHeight - h) / 2))
    deleteOverlay.show(
      { x, y, width: w, height: h },
      {
        type: 'form',
        title: t('delete.title'),
        fields: [{ id: '_warning', label: '', value: t('delete.warning'), readonly: true }],
        actions: [
          { id: 'dismiss', label: t('import.cancelButton') },
          { id: 'confirm-delete', label: t('delete.button'), primary: true },
        ],
      },
      { autoDismiss: true }
    )
  }, [deleteOverlay, t])

  const handleReveal = useCallback(async () => {
    if (isRevealed) {
      setIsRevealed(false)
      setWords(null)
      return
    }
    setExportLoading(true)
    setExportError(null)
    try {
      const mnemonic = await exportMnemonic()
      setWords(mnemonic)
      setIsRevealed(true)
      setTimeout(() => {
        setWords(null)
        setIsRevealed(false)
      }, MNEMONIC_CLEAR_TIMEOUT)
    } catch (err) {
      setExportError(errorMessage(err))
    } finally {
      setExportLoading(false)
    }
  }, [isRevealed, exportMnemonic])

  const handleCopy = useCallback(() => {
    if (!words) return
    navigator.clipboard.writeText(words.join(' '))
    setTimeout(() => navigator.clipboard.writeText(''), 30_000)
    setCopied(true)
    setTimeout(() => setCopied(false), UI_COPY_FEEDBACK_MS)
  }, [words])

  const parseWords = (text: string): string[] =>
    text
      .trim()
      .split(/[\s,]+/)
      .filter((w) => w.length > 0)
  const wordCount = parseWords(importInput).length

  const handleImport = useCallback(async () => {
    const parsed = parseWords(importInput)
    if (parsed.length !== 24) {
      setImportError(t('import.error'))
      return
    }
    if (isCreated && !showConfirm) {
      setShowConfirm(true)
      return
    }
    setImportError(null)
    setShowConfirm(false)
    try {
      await importWallet(parsed)
      setImportInput('')
      setShowImport(false)
    } catch (err) {
      setImportError(errorMessage(err))
    }
  }, [importInput, isCreated, showConfirm, importWallet, t])

  return (
    <div className="mt-6 glass-card px-4 py-4 space-y-4">
      <p className="text-foreground font-medium">{t('settings.walletManagement')}</p>

      {/* Export mnemonic */}
      {isCreated && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground flex items-center gap-2">
              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
              {t('export.title')}
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={handleReveal} disabled={exportLoading}>
              {exportLoading ? (
                <LoaderCircle className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden="true" />
              ) : isRevealed ? (
                <EyeOff className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
              ) : (
                <Eye className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
              )}
              {isRevealed ? t('export.hideButton') : t('export.showButton')}
            </Button>
          </div>

          {exportError && <p className="text-xs text-destructive">{exportError}</p>}

          {isRevealed && words && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 p-3 bg-warning/10 border border-warning/20 rounded-lg">
                <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" aria-hidden="true" />
                <p className="text-xs text-warning">{t('export.warning')}</p>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {words.map((word, i) => (
                  <div key={i} className="flex items-center gap-1.5 px-2 py-1.5 bg-muted rounded text-xs">
                    <span className="text-muted-foreground w-5 text-right">{i + 1}.</span>
                    <span className="font-mono text-foreground">{word}</span>
                  </div>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={handleCopy} className="w-full">
                {copied ? <Check className="h-3.5 w-3.5 mr-1.5" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
                {copied ? t('export.copied') : t('receive.copyButton')}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Import wallet */}
      <div className="border-t border-border pt-4">
        {!showImport ? (
          <button
            type="button"
            className="text-sm text-primary hover:underline flex items-center gap-2"
            onClick={() => setShowImport(true)}
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            {isCreated ? t('import.title') : t('create.orImport')}
          </button>
        ) : showConfirm ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" aria-hidden="true" />
              <p className="text-sm text-destructive">{t('import.confirm')}</p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="destructive"
                onClick={handleImport}
                disabled={isLoading}
                className="flex-1"
              >
                {isLoading && <LoaderCircle className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />}
                {t('import.confirmButton')}
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowConfirm(false)} className="flex-1">
                {t('import.cancelButton')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{t('import.title')}</span>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setShowImport(false)
                  setImportInput('')
                  setImportError(null)
                }}
              >
                {t('import.cancelButton')}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">{t('import.description')}</p>
            <textarea
              className={cn(
                'w-full h-24 p-3 text-sm rounded-lg border bg-background text-foreground resize-none',
                'focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground'
              )}
              placeholder={t('import.placeholder')}
              value={importInput}
              onChange={(e) => {
                setImportInput(e.target.value)
                setImportError(null)
              }}
              spellCheck={false}
              autoComplete="off"
            />
            <div className="flex items-center justify-between">
              <span className={cn('text-xs', wordCount === 24 ? 'text-success' : 'text-muted-foreground')}>
                {wordCount}/24
              </span>
              {importError && <span className="text-xs text-destructive">{importError}</span>}
            </div>
            <Button type="button" onClick={handleImport} disabled={isLoading || wordCount !== 24} className="w-full">
              {isLoading ? (
                <LoaderCircle className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
              ) : (
                <Upload className="h-4 w-4 mr-2" aria-hidden="true" />
              )}
              {isLoading ? t('import.importing') : t('import.button')}
            </Button>
          </div>
        )}
      </div>

      {/* Delete wallet */}
      {isCreated && (
        <div className="border-t border-border pt-4">
          <button
            type="button"
            className="text-sm text-destructive hover:underline flex items-center gap-2"
            onClick={showDeleteOverlay}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            {t('delete.button')}
          </button>
          <p className="text-xs text-muted-foreground mt-1">{t('delete.description')}</p>
        </div>
      )}
    </div>
  )
}
