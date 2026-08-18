/**
 * Wallet page at ton://wallet.
 * Layout: balance + action buttons always visible, transaction history below.
 * Send/Receive triggered via action buttons as inline views.
 */

import { errorMessage } from '@shared/errors'
import type { WalletTransaction } from '@shared/types'
import { useEffect, useRef, useState, useCallback, memo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ArrowUp, ArrowDown, RefreshCw, Plus, LoaderCircle, AlertTriangle, ArrowLeft, LockKeyhole } from 'lucide-react'
import Lottie from 'lottie-react'
import explorerAnimation from '@/assets/explorer.json'
import { Button } from '@/components/ui/button'
import { AppIcon } from '@/components/ui/AppIcon'
import { useWalletStore } from '@/features/wallet/store'
import { formatTonAmount } from '@/lib/ton-utils'
import { SendForm } from '@/features/wallet/components/SendForm'
import { ReceivePanel } from '@/features/wallet/components/ReceivePanel'
import { TransactionList } from '@/features/wallet/components/TransactionList'
import { TransactionDetailSheet } from '@/features/wallet/components/TransactionDetailSheet'
import { ActionButton } from '@/components/ui/ios/ActionButton'
import { ActionTile } from '@/components/ui/ios/ActionTile'
import { BalanceHero } from '@/components/ui/ios/BalanceHero'
import { InsetGroup } from '@/components/ui/ios/InsetGroup'
import { AddressChip } from '@/components/ui/ios/AddressChip'
import { UI_COPY_FEEDBACK_MS } from '@shared/constants'
import { useTranslation } from 'react-i18next'
import { WalletPasswordFields } from './WalletPasswordFields'
import { WalletSecurityScreen } from './WalletSecurityScreen'
import type { WalletAccountCandidate } from '@shared/ipc-contract/wallet'
import { WalletBackupChallenge } from './WalletBackupChallenge'
import { copySensitiveText } from '../sensitive-clipboard'
import { WalletRecoveryScreen } from './WalletRecoveryScreen'
import { walletClient } from '@/features/wallet/client'
import { WalletBackupPhraseScreen } from './WalletBackupPhraseScreen'

type ActionView = 'send' | 'receive' | null
type BackupFlowStep = 'idle' | 'phrase' | 'challenge'
export function WalletPage() {
  const { t } = useTranslation('wallet')
  const {
    isCreated,
    address,
    balance,
    transactions,
    isLoading,
    isSending,
    error,
    decryptFailed,
    weakEncryption,
    isLocked,
    needsPasswordSetup,
    passwordProtected,
    backupVerified,
    init,
    create,
    importWallet,
    discoverAccounts,
    send,
    loadHistory,
    refreshBalance,
    unlock,
    setupPassword,
    markBackupVerified,
    createBackupChallenge,
    exportMnemonic,
    lock,
    deleteWallet,
  } = useWalletStore(
    useShallow((s) => ({
      isCreated: s.isCreated,
      address: s.address,
      balance: s.balance,
      transactions: s.transactions,
      isLoading: s.isLoading,
      isSending: s.isSending,
      error: s.error,
      decryptFailed: s.decryptFailed,
      weakEncryption: s.weakEncryption,
      isLocked: s.isLocked,
      needsPasswordSetup: s.needsPasswordSetup,
      passwordProtected: s.passwordProtected,
      backupVerified: s.backupVerified,
      init: s.init,
      create: s.create,
      importWallet: s.importWallet,
      discoverAccounts: s.discoverAccounts,
      send: s.send,
      loadHistory: s.loadHistory,
      refreshBalance: s.refreshBalance,
      unlock: s.unlock,
      setupPassword: s.setupPassword,
      markBackupVerified: s.markBackupVerified,
      createBackupChallenge: s.createBackupChallenge,
      exportMnemonic: s.exportMnemonic,
      lock: s.lock,
      deleteWallet: s.deleteWallet,
    }))
  )
  const [newMnemonic, setNewMnemonic] = useState<string[] | null>(null)
  const [copied, setCopied] = useState(false)
  const [actionView, setActionView] = useState<ActionView>(null)
  const [selectedTx, setSelectedTx] = useState<WalletTransaction | null>(null)
  const [recoveryInput, setRecoveryInput] = useState('')
  const [recoveryError, setRecoveryError] = useState<string | null>(null)
  const [recoveryPasswordRequired, setRecoveryPasswordRequired] = useState(false)
  const [mnemonicRevealed, setMnemonicRevealed] = useState(false)
  const [walletPassword, setWalletPassword] = useState('')
  const [walletPasswordConfirm, setWalletPasswordConfirm] = useState('')
  const [securityError, setSecurityError] = useState<string | null>(null)
  const [backupAnswers, setBackupAnswers] = useState<Record<number, string>>({})
  const [backupChallenge, setBackupChallenge] = useState<{ challengeId: string; indexes: number[] } | null>(null)
  const [backupStep, setBackupStep] = useState<BackupFlowStep>('idle')
  const [backupPending, setBackupPending] = useState(false)
  const [createPasswordRequired, setCreatePasswordRequired] = useState(false)
  const [accountCandidates, setAccountCandidates] = useState<WalletAccountCandidate[]>([])
  const [selectedAccount, setSelectedAccount] = useState<WalletAccountCandidate | null>(null)
  const mnemonicTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingBackupPasswordRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (newMnemonic) {
      mnemonicTimerRef.current = setTimeout(() => {
        newMnemonic.fill('')
        setNewMnemonic(null)
        setMnemonicRevealed(false)
        setBackupStep('idle')
        pendingBackupPasswordRef.current = undefined
        setSecurityError('Recovery phrase display expired. Restart backup verification.')
      }, 5 * 60_000)
    }
    return () => {
      if (mnemonicTimerRef.current) clearTimeout(mnemonicTimerRef.current)
      newMnemonic?.fill('')
    }
  }, [newMnemonic])
  useEffect(() => {
    void walletClient.setSensitiveDisplay(Boolean(newMnemonic))
    return () => {
      void walletClient.setSensitiveDisplay(false)
    }
  }, [newMnemonic])
  // Wipe mnemonic on component unmount
  useEffect(() => {
    return () => {
      pendingBackupPasswordRef.current = undefined
    }
  }, [])
  useEffect(() => {
    if (backupStep !== 'challenge') return
    const timer = setTimeout(() => {
      pendingBackupPasswordRef.current = undefined
      setBackupChallenge(null)
      setBackupAnswers({})
      setBackupStep('idle')
      setSecurityError('Verification expired. Restart backup verification.')
    }, 5 * 60_000)
    return () => clearTimeout(timer)
  }, [backupStep])
  const parseWords = (text: string): string[] =>
    text
      .trim()
      .split(/[\s,]+/)
      .filter((w) => w.length > 0)

  const handleRecoveryImport = useCallback(async () => {
    const parsed = parseWords(recoveryInput)
    if (parsed.length !== 12 && parsed.length !== 24) {
      setRecoveryError(t('import.error'))
      return
    }
    setRecoveryError(null)
    try {
      if (accountCandidates.length === 0) {
        setAccountCandidates(await discoverAccounts(parsed))
        return
      }
      if (!selectedAccount) {
        setRecoveryError('Select the wallet account you want to import.')
        return
      }
      if (recoveryPasswordRequired && (walletPassword.length < 10 || walletPassword !== walletPasswordConfirm)) {
        setRecoveryError('Choose and confirm an app password of at least 10 characters.')
        return
      }
      await importWallet(
        parsed,
        recoveryPasswordRequired ? walletPassword : undefined,
        selectedAccount.version,
        selectedAccount.scheme
      )
      setRecoveryInput('')
      setRecoveryPasswordRequired(false)
      setWalletPassword('')
      setWalletPasswordConfirm('')
    } catch (err) {
      const message = errorMessage(err)
      if (message.toLowerCase().includes('password')) setRecoveryPasswordRequired(true)
      setRecoveryError(message)
    }
  }, [
    recoveryInput,
    importWallet,
    discoverAccounts,
    t,
    accountCandidates.length,
    selectedAccount,
    recoveryPasswordRequired,
    walletPassword,
    walletPasswordConfirm,
  ])

  useEffect(() => {
    init()
    loadHistory()
  }, [init, loadHistory])
  const handleRefresh = () => {
    refreshBalance()
    loadHistory()
  }
  const openBackupPhrase = useCallback((password: string | undefined, words: string[]) => {
    pendingBackupPasswordRef.current = password
    setNewMnemonic(words)
    setBackupStep('phrase')
    setBackupChallenge(null)
    setBackupAnswers({})
    setMnemonicRevealed(false)
    setSecurityError(null)
    setWalletPassword('')
    setWalletPasswordConfirm('')
  }, [])
  const handleCreate = useCallback(async () => {
    if (createPasswordRequired && (walletPassword.length < 10 || walletPassword !== walletPasswordConfirm)) {
      setSecurityError('Choose and confirm a wallet password of at least 10 characters.')
      return
    }
    const password = createPasswordRequired ? walletPassword : undefined
    setSecurityError(null)
    try {
      const words = await create(password)
      if (words) openBackupPhrase(password, words)
    } catch (err) {
      const message = errorMessage(err)
      if (message.toLowerCase().includes('password')) setCreatePasswordRequired(true)
      setSecurityError(message)
    }
  }, [create, createPasswordRequired, openBackupPhrase, walletPassword, walletPasswordConfirm])
  const handleUnlock = useCallback(async () => {
    setSecurityError(null)
    const password = walletPassword
    try {
      await unlock(password)
      if (!useWalletStore.getState().backupVerified) {
        openBackupPhrase(password, await exportMnemonic(password))
      } else {
        setWalletPassword('')
      }
    } catch (err) {
      setSecurityError(errorMessage(err))
    }
  }, [exportMnemonic, openBackupPhrase, unlock, walletPassword])
  const handlePasswordSetup = useCallback(async () => {
    if (walletPassword.length < 10 || walletPassword !== walletPasswordConfirm) {
      setSecurityError('Choose and confirm a wallet password of at least 10 characters.')
      return
    }
    const password = walletPassword
    try {
      await setupPassword(password)
      if (!useWalletStore.getState().backupVerified) {
        openBackupPhrase(password, await exportMnemonic(password))
      } else {
        setWalletPassword('')
        setWalletPasswordConfirm('')
      }
    } catch (err) {
      setSecurityError(errorMessage(err))
    }
  }, [exportMnemonic, openBackupPhrase, setupPassword, walletPassword, walletPasswordConfirm])
  const handleCopyMnemonic = useCallback(() => {
    if (!newMnemonic) return
    void copySensitiveText(newMnemonic.join(' '))
    setCopied(true)
    setTimeout(() => setCopied(false), UI_COPY_FEEDBACK_MS)
  }, [newMnemonic])
  const handleBeginBackupChallenge = useCallback(async () => {
    const password = pendingBackupPasswordRef.current
    if (!newMnemonic) return
    setBackupPending(true)
    setSecurityError(null)
    try {
      setBackupChallenge(await createBackupChallenge(password))
      setBackupAnswers({})
      setMnemonicRevealed(false)
      setBackupStep('challenge')
    } catch (err) {
      setSecurityError(errorMessage(err))
    } finally {
      setBackupPending(false)
    }
  }, [createBackupChallenge, newMnemonic])

  const handleVerifyBackup = useCallback(async () => {
    const password = pendingBackupPasswordRef.current
    if (!backupChallenge) return
    setBackupPending(true)
    setSecurityError(null)
    try {
      await markBackupVerified(
        backupChallenge.challengeId,
        password,
        backupChallenge.indexes.map((index) => backupAnswers[index] ?? '')
      )
      setBackupAnswers({})
      setBackupChallenge(null)
      setBackupStep('idle')
      setNewMnemonic(null)
      setMnemonicRevealed(false)
      pendingBackupPasswordRef.current = undefined
    } catch (err) {
      setBackupAnswers({})
      setSecurityError(errorMessage(err))
      try {
        setBackupChallenge(await createBackupChallenge(password))
      } catch {
        setBackupChallenge(null)
        setBackupStep('idle')
        setNewMnemonic(null)
        pendingBackupPasswordRef.current = undefined
        setSecurityError('Verification expired. Restart backup verification.')
      }
    } finally {
      setBackupPending(false)
    }
  }, [backupAnswers, backupChallenge, createBackupChallenge, markBackupVerified])

  if (isLoading && !isCreated) {
    return (
      <div
        className="flex items-center justify-center h-full bg-background-secondary"
        style={{ fontFamily: 'Inter, sans-serif' }}
      >
        <LoaderCircle className="h-8 w-8 text-muted-foreground animate-spin" aria-hidden="true" />
      </div>
    )
  }

  // Recovery screen when system keyring changed and wallet cannot be decrypted
  if (decryptFailed) {
    return (
      <WalletRecoveryScreen
        recoveryInput={recoveryInput}
        recoveryError={recoveryError}
        isLoading={isLoading}
        passwordRequired={recoveryPasswordRequired}
        password={walletPassword}
        confirmation={walletPasswordConfirm}
        candidates={accountCandidates}
        selected={selectedAccount}
        onRecoveryInput={(value) => {
          setRecoveryInput(value)
          setRecoveryError(null)
          setAccountCandidates([])
          setSelectedAccount(null)
        }}
        onPassword={setWalletPassword}
        onConfirmation={setWalletPasswordConfirm}
        onSelect={setSelectedAccount}
        onImport={handleRecoveryImport}
        onDelete={deleteWallet}
      />
    )
  }

  if (backupStep === 'phrase' && newMnemonic) {
    return (
      <WalletBackupPhraseScreen
        words={newMnemonic}
        revealed={mnemonicRevealed}
        copied={copied}
        pending={backupPending}
        error={securityError}
        onReveal={() => setMnemonicRevealed((revealed) => !revealed)}
        onCopy={handleCopyMnemonic}
        onContinue={handleBeginBackupChallenge}
      />
    )
  }

  if (backupStep === 'challenge' && backupChallenge) {
    return (
      <WalletBackupChallenge
        indexes={backupChallenge.indexes}
        answers={backupAnswers}
        error={securityError}
        pending={backupPending}
        onChange={(index, value) => setBackupAnswers((current) => ({ ...current, [index]: value }))}
        onSubmit={handleVerifyBackup}
        onBack={() => {
          setBackupChallenge(null)
          setBackupAnswers({})
          setSecurityError(null)
          setBackupStep('phrase')
        }}
      />
    )
  }

  if (isCreated && (needsPasswordSetup || isLocked)) {
    return (
      <WalletSecurityScreen
        mode={needsPasswordSetup ? 'setup' : 'unlock'}
        password={walletPassword}
        confirmation={needsPasswordSetup ? walletPasswordConfirm : undefined}
        error={securityError}
        onPasswordChange={setWalletPassword}
        onConfirmationChange={needsPasswordSetup ? setWalletPasswordConfirm : undefined}
        onSubmit={needsPasswordSetup ? handlePasswordSetup : handleUnlock}
      />
    )
  }

  if (isCreated && !backupVerified && !newMnemonic) {
    return (
      <WalletSecurityScreen
        mode="backup"
        password={walletPassword}
        error={securityError}
        showPassword={passwordProtected}
        onPasswordChange={setWalletPassword}
        onSubmit={async () => {
          const password = passwordProtected ? walletPassword : undefined
          try {
            openBackupPhrase(password, await exportMnemonic(password))
          } catch (err) {
            setSecurityError(errorMessage(err))
          }
        }}
      />
    )
  }

  // Send/Receive inline view
  if (actionView) {
    return (
      <div className="h-full bg-background-secondary overflow-auto" style={{ fontFamily: 'Inter, sans-serif' }}>
        <div className="p-5 max-w-md mx-auto">
          <div className="mb-4">
            <button
              type="button"
              onClick={() => setActionView(null)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              {t('send.back')}
            </button>
          </div>
          {actionView === 'send' && <SendForm onSend={send} isSending={isSending} error={error} balance={balance} />}
          {actionView === 'receive' && <ReceivePanel address={address} />}
        </div>
      </div>
    )
  }

  return (
    <div className="h-full bg-background-secondary overflow-auto" style={{ fontFamily: 'Inter, sans-serif' }}>
      <div className="p-5 max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-5 flex items-center justify-center gap-2">
          <AppIcon name="wallet" className="h-5 w-5 text-icon" />
          <h1 className="text-xl font-semibold text-heading">{t('page.title')}</h1>
          {isCreated && (
            <div className="ml-1 flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={handleRefresh}
                title={t('page.refresh')}
                aria-label={t('page.refresh')}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              {passwordProtected && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => void lock()}
                  title="Lock wallet"
                  aria-label="Lock wallet"
                >
                  <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              )}
            </div>
          )}
        </div>

        {!isCreated ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center gap-4 py-10 text-center">
            <Lottie animationData={explorerAnimation} className="mb-1 h-24 w-24" loop autoplay />
            <div>
              <h2 className="text-base font-semibold text-heading">{t('page.noWalletTitle')}</h2>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">{t('page.noWalletDesc')}</p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {createPasswordRequired && (
              <div className="w-full max-w-xs">
                <WalletPasswordFields
                  password={walletPassword}
                  confirmation={walletPasswordConfirm}
                  onPasswordChange={setWalletPassword}
                  onConfirmationChange={setWalletPasswordConfirm}
                  disabled={isLoading}
                />
              </div>
            )}
            {securityError && <p className="text-xs text-destructive">{securityError}</p>}
            <ActionButton
              variant="filled"
              onClick={handleCreate}
              disabled={isLoading}
              className="w-full max-w-xs"
              icon={
                isLoading ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Plus className="h-4 w-4" aria-hidden="true" />
                )
              }
            >
              {t('page.createWallet')}
            </ActionButton>
          </div>
        ) : (
          <div className="max-w-lg mx-auto">
            {/* Weak encryption banner */}
            {weakEncryption && (
              <div className="flex items-center gap-2 px-3 py-2 mb-4 bg-muted rounded-lg border border-border">
                <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" aria-hidden="true" />
                <p className="text-xs text-muted-foreground">{t('recovery.weakEncryption')}</p>
              </div>
            )}

            <AccountPanel
              balance={balance}
              address={address}
              onSend={() => setActionView('send')}
              onReceive={() => setActionView('receive')}
              t={t}
            />

            <InsetGroup title={t('overview.recent')} bodyClassName="py-1">
              <TransactionList transactions={transactions} onSelect={setSelectedTx} />
            </InsetGroup>

            <TransactionDetailSheet tx={selectedTx} selfAddress={address} onClose={() => setSelectedTx(null)} />
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(WalletPage)

// ── Account panel ────────────────────────────────────────────────────────────

interface AccountPanelProps {
  balance: string
  address: string
  onSend: () => void
  onReceive: () => void
  t: ReturnType<typeof useTranslation>['t']
}

function AccountPanel({ balance, address, onSend, onReceive, t }: AccountPanelProps) {
  return (
    <div className="mb-6 space-y-5">
      <BalanceHero amount={formatTonAmount(balance)} unit="GRAM">
        <AddressChip address={address} full />
      </BalanceHero>

      <div className="flex justify-center gap-3">
        <ActionTile icon={<ArrowUp className="h-6 w-6" strokeWidth={2.5} />} label={t('tabs.send')} onClick={onSend} />
        <ActionTile
          icon={<ArrowDown className="h-6 w-6" strokeWidth={2.5} />}
          label={t('tabs.receive')}
          onClick={onReceive}
        />
      </div>
    </div>
  )
}
