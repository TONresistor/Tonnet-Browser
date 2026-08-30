import { errorMessage } from '@shared/errors'
import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { UI_COPY_FEEDBACK_MS } from '@shared/constants'
import { LoaderCircle, Eye, EyeOff, Upload, KeyRound, Copy, Check, AlertTriangle, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWalletManagement } from '@/features/wallet/public'
import { cn } from '@/lib/utils'
import { WalletPasswordFields } from '@/features/wallet/components/WalletPasswordFields'
import { WalletAccountCandidates } from '@/features/wallet/components/WalletAccountCandidates'
import { copySensitiveText } from '@/features/wallet/sensitive-clipboard'
import { WalletChangePassword } from '@/features/wallet/components/WalletChangePassword'
import { WalletAddPassword } from '@/features/wallet/components/WalletAddPassword'
import { WalletSystemStorageGate } from '@/features/wallet/components/WalletSystemStorageGate'
import type { WalletAccountCandidate } from '@shared/ipc-contract/wallet'
import { walletClient } from '@/features/wallet/client'
import { useUIStore } from '@/features/settings/ui-store'
import { SettingRow } from '../shared/SettingRow'

const MNEMONIC_CLEAR_TIMEOUT = 60_000
type ManagementAction = 'recovery' | 'password' | 'import' | 'delete'

export function WalletManagementPanel() {
  const { t } = useTranslation('wallet')
  const {
    isCreated,
    passwordProtected,
    systemStorageBlocked,
    discoverAccounts,
    importWallet,
    exportMnemonic,
    deleteWallet,
    isLoading,
  } = useWalletManagement()
  const [words, setWords] = useState<string[] | null>(null)
  const [isRevealed, setIsRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportLoading, setExportLoading] = useState(false)
  const [activeAction, setActiveAction] = useState<ManagementAction | null>(null)
  const [importInput, setImportInput] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [walletPassword, setWalletPassword] = useState('')
  const [importPassword, setImportPassword] = useState('')
  const [importPasswordConfirm, setImportPasswordConfirm] = useState('')
  const [accountCandidates, setAccountCandidates] = useState<WalletAccountCandidate[]>([])
  const [selectedAccount, setSelectedAccount] = useState<WalletAccountCandidate | null>(null)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const walletManagementIntent = useUIStore((state) => state.walletManagementIntent)
  const setWalletManagementIntent = useUIStore((state) => state.setWalletManagementIntent)

  useEffect(() => {
    if (walletManagementIntent !== 'import') return
    setActiveAction('import')
    setWalletManagementIntent(null)
  }, [setWalletManagementIntent, walletManagementIntent])

  useEffect(() => {
    void walletClient.setSensitiveDisplay(Boolean(words))
    return () => {
      void walletClient.setSensitiveDisplay(false)
    }
  }, [words])

  const handleDelete = useCallback(async () => {
    setDeleteLoading(true)
    setDeleteError(null)
    try {
      await deleteWallet(deletePassword)
      setDeletePassword('')
      setActiveAction(null)
    } catch (error) {
      setDeleteError(errorMessage(error))
      setDeletePassword('')
    } finally {
      setDeleteLoading(false)
    }
  }, [deletePassword, deleteWallet])

  const handleReveal = useCallback(async () => {
    if (isRevealed) {
      setIsRevealed(false)
      setWords(null)
      setWalletPassword('')
      return
    }
    setExportLoading(true)
    setExportError(null)
    try {
      const mnemonic = await exportMnemonic(passwordProtected ? walletPassword : undefined)
      setWords(mnemonic)
      setIsRevealed(true)
      setWalletPassword('')
      setTimeout(() => {
        setWords(null)
        setIsRevealed(false)
      }, MNEMONIC_CLEAR_TIMEOUT)
    } catch (err) {
      setExportError(errorMessage(err))
    } finally {
      setExportLoading(false)
    }
  }, [isRevealed, exportMnemonic, passwordProtected, walletPassword])

  const handleCopy = useCallback(() => {
    if (!words) return
    void copySensitiveText(words.join(' '))
    setCopied(true)
    setTimeout(() => setCopied(false), UI_COPY_FEEDBACK_MS)
  }, [words])

  const parseWords = (text: string): string[] =>
    text
      .trim()
      .split(/[\s,]+/)
      .filter((w) => w.length > 0)
  const wordCount = parseWords(importInput).length

  const resetRecovery = useCallback(() => {
    setWords(null)
    setIsRevealed(false)
    setWalletPassword('')
    setExportError(null)
    setCopied(false)
  }, [])

  const resetImport = useCallback(() => {
    setImportInput('')
    setImportError(null)
    setImportPassword('')
    setImportPasswordConfirm('')
    setAccountCandidates([])
    setSelectedAccount(null)
    setShowConfirm(false)
  }, [])

  const resetDelete = useCallback(() => {
    setDeletePassword('')
    setDeleteError(null)
  }, [])

  const toggleAction = useCallback(
    (action: ManagementAction) => {
      const nextAction = activeAction === action ? null : action
      resetRecovery()
      resetImport()
      resetDelete()
      setActiveAction(nextAction)
    },
    [activeAction, resetDelete, resetImport, resetRecovery]
  )

  const handleImport = useCallback(async () => {
    const parsed = parseWords(importInput)
    if (parsed.length !== 24) {
      setImportError(t('import.error'))
      return
    }
    if (accountCandidates.length === 0) {
      try {
        setAccountCandidates(await discoverAccounts(parsed))
      } catch (err) {
        setImportError(errorMessage(err))
      }
      return
    }
    if (!selectedAccount) {
      setImportError('Select the wallet account you want to import.')
      return
    }
    if (importPassword.length < 10 || importPassword !== importPasswordConfirm) {
      setImportError('Choose and confirm an app password of at least 10 characters.')
      return
    }
    if (isCreated && !showConfirm) {
      setShowConfirm(true)
      return
    }
    setImportError(null)
    setShowConfirm(false)
    try {
      await importWallet(parsed, importPassword, selectedAccount.version)
      resetImport()
      setActiveAction(null)
    } catch (err) {
      const message = errorMessage(err)
      setImportError(message)
    }
  }, [
    importInput,
    isCreated,
    showConfirm,
    importWallet,
    discoverAccounts,
    t,
    importPassword,
    importPasswordConfirm,
    accountCandidates.length,
    selectedAccount,
    resetImport,
  ])

  if (systemStorageBlocked) {
    return (
      <div className="mt-6">
        <WalletSystemStorageGate variant="settings" />
      </div>
    )
  }

  return (
    <div className="mt-6 space-y-6">
      {isCreated && (
        <div>
          <h3 className="mb-2 px-1 text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('settings.management.accessTitle', { defaultValue: 'Access and recovery' })}
          </h3>
          <div className="settings-group px-4">
            <SettingRow
              label={t('export.title')}
              description={t('settings.management.recoveryDescription', {
                defaultValue: 'View and save your 24 recovery words.',
              })}
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => toggleAction('recovery')}
                aria-expanded={activeAction === 'recovery'}
                aria-controls="wallet-recovery-panel"
              >
                {isRevealed ? (
                  <EyeOff className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                )}
                {activeAction === 'recovery'
                  ? isRevealed
                    ? t('export.hideButton')
                    : t('import.cancelButton')
                  : t('settings.management.view', { defaultValue: 'View' })}
              </Button>
            </SettingRow>

            {activeAction === 'recovery' && (
              <div id="wallet-recovery-panel" className="border-b border-border-subtle py-4">
                {!isRevealed ? (
                  <form
                    className="space-y-3"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void handleReveal()
                    }}
                  >
                    {passwordProtected && (
                      <WalletPasswordFields
                        password={walletPassword}
                        onPasswordChange={(value) => {
                          setWalletPassword(value)
                          setExportError(null)
                        }}
                        disabled={exportLoading}
                      />
                    )}
                    <Button
                      type="submit"
                      variant="outline"
                      size="sm"
                      className="w-full"
                      disabled={exportLoading || (passwordProtected && walletPassword.length < 10)}
                    >
                      {exportLoading && <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                      {t('export.showButton')}
                    </Button>
                    {exportError && (
                      <p role="alert" className="text-xs text-destructive">
                        {exportError}
                      </p>
                    )}
                  </form>
                ) : (
                  words && (
                    <div className="space-y-3">
                      <div className="flex items-start gap-2 rounded-lg border border-warning/20 bg-warning/10 p-3">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                        <p className="text-xs text-warning">{t('export.warning')}</p>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        {words.map((word, index) => (
                          <div key={index} className="flex items-center gap-1.5 rounded bg-muted px-2 py-1.5 text-xs">
                            <span className="w-5 text-right text-muted-foreground">{index + 1}.</span>
                            <span className="font-mono text-foreground">{word}</span>
                          </div>
                        ))}
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={handleCopy} className="w-full">
                        {copied ? (
                          <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        {copied ? t('export.copied') : t('receive.copyButton')}
                      </Button>
                    </div>
                  )
                )}
              </div>
            )}

            <SettingRow
              label={t('settings.management.passwordTitle', { defaultValue: 'Wallet password' })}
              description={
                passwordProtected
                  ? t('settings.management.passwordEnabled', { defaultValue: 'Password protection is enabled.' })
                  : t('settings.management.passwordOptional', {
                      defaultValue: 'Add an app password for extra protection.',
                    })
              }
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => toggleAction('password')}
                aria-expanded={activeAction === 'password'}
                aria-controls="wallet-password-panel"
              >
                <KeyRound className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {activeAction === 'password'
                  ? t('import.cancelButton')
                  : passwordProtected
                    ? t('settings.management.change', { defaultValue: 'Change' })
                    : t('settings.management.add', { defaultValue: 'Add' })}
              </Button>
            </SettingRow>

            {activeAction === 'password' && (
              <div id="wallet-password-panel" className="py-4">
                {passwordProtected ? <WalletChangePassword /> : <WalletAddPassword />}
              </div>
            )}
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-2 px-1 text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
          {t('settings.management.walletTitle', { defaultValue: 'Wallet' })}
        </h3>
        <div className="settings-group px-4">
          <SettingRow
            label={
              isCreated ? t('settings.management.replaceTitle', { defaultValue: 'Replace wallet' }) : t('import.title')
            }
            description={
              isCreated
                ? t('settings.management.replaceDescription', {
                    defaultValue: 'Import another recovery phrase. This replaces the current wallet.',
                  })
                : t('import.description')
            }
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={() => toggleAction('import')}
              aria-expanded={activeAction === 'import'}
              aria-controls="wallet-import-panel"
            >
              <Upload className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {activeAction === 'import'
                ? t('import.cancelButton')
                : isCreated
                  ? t('settings.management.replace', { defaultValue: 'Replace' })
                  : t('settings.management.import', { defaultValue: 'Import' })}
            </Button>
          </SettingRow>

          {activeAction === 'import' && (
            <div id="wallet-import-panel" className="py-4">
              {showConfirm ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
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
                      {isLoading && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                      {t('import.confirmButton')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setShowConfirm(false)
                        setImportPassword('')
                        setImportPasswordConfirm('')
                      }}
                      className="flex-1"
                    >
                      {t('settings.management.back', { defaultValue: 'Back' })}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <WalletPasswordFields
                    password={importPassword}
                    confirmation={importPasswordConfirm}
                    onPasswordChange={(value) => {
                      setImportPassword(value)
                      setImportError(null)
                    }}
                    onConfirmationChange={(value) => {
                      setImportPasswordConfirm(value)
                      setImportError(null)
                    }}
                    disabled={isLoading}
                  />
                  <textarea
                    className={cn(
                      'h-24 w-full resize-none rounded-lg border bg-background p-3 text-sm text-foreground',
                      'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
                    )}
                    placeholder={t('import.placeholder')}
                    value={importInput}
                    onChange={(event) => {
                      setImportInput(event.target.value)
                      setImportError(null)
                      setAccountCandidates([])
                      setSelectedAccount(null)
                    }}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <WalletAccountCandidates
                    candidates={accountCandidates}
                    selected={selectedAccount}
                    onSelect={setSelectedAccount}
                  />
                  <p className={cn('text-xs', wordCount === 24 ? 'text-success' : 'text-muted-foreground')}>
                    {wordCount} words
                  </p>
                  <Button
                    type="button"
                    onClick={handleImport}
                    disabled={isLoading || wordCount !== 24}
                    className="w-full"
                  >
                    {isLoading ? (
                      <LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
                    )}
                    {isLoading
                      ? t('import.importing')
                      : accountCandidates.length === 0
                        ? 'Find wallet accounts'
                        : 'Import selected account'}
                  </Button>
                  {importError && (
                    <p role="alert" className="text-xs text-destructive">
                      {importError}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {isCreated && passwordProtected && (
        <div className="settings-group border-destructive/30 bg-destructive/5 px-4">
          <SettingRow
            label={t('settings.management.removeTitle', { defaultValue: 'Remove wallet from this device' })}
            description={t('delete.description')}
          >
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="rounded-full"
              onClick={() => toggleAction('delete')}
              aria-expanded={activeAction === 'delete'}
              aria-controls="wallet-delete-panel"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {activeAction === 'delete'
                ? t('import.cancelButton')
                : t('settings.management.remove', { defaultValue: 'Remove' })}
            </Button>
          </SettingRow>

          {activeAction === 'delete' && (
            <form
              id="wallet-delete-panel"
              className="space-y-3 py-4"
              onSubmit={(event) => {
                event.preventDefault()
                void handleDelete()
              }}
            >
              <p className="text-xs text-destructive">{t('delete.warning')}</p>
              <WalletPasswordFields
                password={deletePassword}
                onPasswordChange={(password) => {
                  setDeletePassword(password)
                  setDeleteError(null)
                }}
                disabled={deleteLoading}
              />
              <div className="flex gap-2">
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={deleteLoading || deletePassword.length < 10}
                  className="flex-1"
                >
                  {deleteLoading && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                  {t('delete.button')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => toggleAction('delete')}
                  disabled={deleteLoading}
                  className="flex-1"
                >
                  {t('import.cancelButton')}
                </Button>
              </div>
              {deleteError && (
                <p role="alert" className="text-xs text-destructive">
                  {deleteError}
                </p>
              )}
            </form>
          )}
        </div>
      )}
    </div>
  )
}
