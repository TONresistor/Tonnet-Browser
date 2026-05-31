/**
 * Wallet page at ton://wallet.
 * Layout: balance + action buttons always visible, transaction history below.
 * Send/Receive triggered via action buttons as inline views.
 */

import { errorMessage } from '@shared/errors'
import { useEffect, useRef, useState, useCallback, memo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  Send,
  Download,
  RefreshCw,
  Plus,
  LoaderCircle,
  AlertTriangle,
  Check,
  Copy,
  ArrowLeft,
  Upload,
  Eye,
  EyeOff,
} from 'lucide-react'
import Lottie from 'lottie-react'
import explorerAnimation from '@/assets/explorer.json'
import walletIcon from '@/assets/wallet.svg'
import { Button } from '@/components/ui/button'
import { truncateAddress } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useWalletStore, formatTonAmount } from '@/stores/wallet'
import { SendForm } from '@/components/wallet/SendForm'
import { ReceivePanel } from '@/components/wallet/ReceivePanel'
import { TransactionList } from '@/components/wallet/TransactionList'
import { UI_COPY_FEEDBACK_MS } from '@shared/constants'
import { useTranslation } from 'react-i18next'

type ActionView = 'send' | 'receive' | null

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
    init,
    create,
    importWallet,
    send,
    loadHistory,
    refreshBalance,
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
      init: s.init,
      create: s.create,
      importWallet: s.importWallet,
      send: s.send,
      loadHistory: s.loadHistory,
      refreshBalance: s.refreshBalance,
    }))
  )
  const [newMnemonic, setNewMnemonic] = useState<string[] | null>(null)
  const [copied, setCopied] = useState(false)
  const [actionView, setActionView] = useState<ActionView>(null)
  const [recoveryInput, setRecoveryInput] = useState('')
  const [recoveryError, setRecoveryError] = useState<string | null>(null)
  const [backupAcknowledged, setBackupAcknowledged] = useState(false)
  const [mnemonicRevealed, setMnemonicRevealed] = useState(false)
  const mnemonicTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-clear mnemonic from memory after 60s
  useEffect(() => {
    if (newMnemonic) {
      mnemonicTimerRef.current = setTimeout(() => {
        setNewMnemonic(null)
        setBackupAcknowledged(false)
        setMnemonicRevealed(false)
      }, 60_000)
    }
    return () => {
      if (mnemonicTimerRef.current) clearTimeout(mnemonicTimerRef.current)
    }
  }, [newMnemonic])

  // Wipe mnemonic on component unmount
  useEffect(() => {
    return () => {
      setNewMnemonic(null)
      setBackupAcknowledged(false)
      setMnemonicRevealed(false)
    }
  }, [])

  const parseWords = (text: string): string[] =>
    text
      .trim()
      .split(/[\s,]+/)
      .filter((w) => w.length > 0)

  const handleRecoveryImport = useCallback(async () => {
    const parsed = parseWords(recoveryInput)
    if (parsed.length !== 24) {
      setRecoveryError(t('import.error'))
      return
    }
    setRecoveryError(null)
    try {
      await importWallet(parsed)
      setRecoveryInput('')
    } catch (err) {
      setRecoveryError(errorMessage(err))
    }
  }, [recoveryInput, importWallet, t])

  useEffect(() => {
    init()
    loadHistory()
  }, [init, loadHistory])

  const handleRefresh = () => {
    refreshBalance()
    loadHistory()
  }

  const handleCreate = useCallback(async () => {
    const words = await create()
    if (words) setNewMnemonic(words)
  }, [create])

  const handleCopyMnemonic = useCallback(() => {
    if (!newMnemonic) return
    navigator.clipboard.writeText(newMnemonic.join(' '))
    setTimeout(() => navigator.clipboard.writeText(''), 30_000)
    setCopied(true)
    setTimeout(() => setCopied(false), UI_COPY_FEEDBACK_MS)
  }, [newMnemonic])

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
    const recoveryWordCount = parseWords(recoveryInput).length
    return (
      <div className="h-full bg-background-secondary overflow-auto" style={{ fontFamily: 'Inter, sans-serif' }}>
        <div className="p-8 max-w-4xl mx-auto">
          <div className="mb-8">
            <div className="flex items-center gap-3">
              <img src={walletIcon} alt="" className="w-8 h-8" />
              <h1 className="text-3xl font-bold text-foreground">{t('page.title')}</h1>
            </div>
          </div>

          <div className="max-w-lg mx-auto space-y-6">
            <div className="flex items-start gap-3 p-4 bg-muted border border-border rounded-2xl">
              <AlertTriangle className="h-5 w-5 text-warning mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-foreground">{t('recovery.title')}</p>
                <p className="text-xs text-muted-foreground mt-1">{t('recovery.description')}</p>
              </div>
            </div>

            <div className="glass-card p-5 space-y-3">
              <textarea
                className={cn(
                  'w-full h-24 p-3 text-sm rounded-lg border bg-background text-foreground resize-none',
                  'focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground'
                )}
                placeholder={t('import.placeholder')}
                value={recoveryInput}
                onChange={(e) => {
                  setRecoveryInput(e.target.value)
                  setRecoveryError(null)
                }}
                spellCheck={false}
                autoComplete="off"
              />
              <div className="flex items-center justify-between">
                <span className={cn('text-xs', recoveryWordCount === 24 ? 'text-success' : 'text-muted-foreground')}>
                  {recoveryWordCount}/24
                </span>
                {recoveryError && <span className="text-xs text-destructive">{recoveryError}</span>}
              </div>
              <Button
                type="button"
                onClick={handleRecoveryImport}
                disabled={isLoading || recoveryWordCount !== 24}
                className="w-full"
              >
                {isLoading ? (
                  <LoaderCircle className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" aria-hidden="true" />
                )}
                {isLoading ? t('import.importing') : t('recovery.importButton')}
              </Button>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground">{t('recovery.orCreateNew')}</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <Button type="button" variant="outline" onClick={handleCreate} disabled={isLoading} className="w-full">
              {isLoading ? (
                <LoaderCircle className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
              )}
              {t('page.createWallet')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Show mnemonic backup screen after wallet creation
  if (newMnemonic) {
    return (
      <div className="h-full bg-background-secondary overflow-auto" style={{ fontFamily: 'Inter, sans-serif' }}>
        <div className="p-8 max-w-4xl mx-auto">
          <div className="mb-8">
            <div className="flex items-center gap-3">
              <img src={walletIcon} alt="" className="w-8 h-8" />
              <h1 className="text-3xl font-bold text-foreground">{t('backup.title')}</h1>
            </div>
          </div>

          <div className="max-w-lg mx-auto space-y-6">
            <div className="flex items-start gap-3 p-4 bg-warning/10 border border-warning/20 rounded-2xl">
              <AlertTriangle className="h-5 w-5 text-warning mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-foreground">{t('backup.warning')}</p>
                <p className="text-xs text-muted-foreground mt-1">{t('backup.warningDesc')}</p>
              </div>
            </div>

            <div className="glass-card p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-medium text-foreground">{t('backup.yourPhrase')}</p>
                <Button type="button" variant="ghost" size="sm" onClick={() => setMnemonicRevealed(!mnemonicRevealed)}>
                  {mnemonicRevealed ? (
                    <EyeOff className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                  ) : (
                    <Eye className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                  )}
                  {mnemonicRevealed ? t('export.hideButton') : t('export.showButton')}
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {newMnemonic.map((word, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg text-sm">
                    <span className="text-muted-foreground w-6 text-right font-mono text-xs">{i + 1}.</span>
                    <span className="font-mono text-foreground">
                      {mnemonicRevealed ? word : '\u2022\u2022\u2022\u2022\u2022'}
                    </span>
                  </div>
                ))}
              </div>

              <Button type="button" variant="outline" onClick={handleCopyMnemonic} className="w-full mt-4">
                {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                {copied ? t('export.copied') : t('backup.copy')}
              </Button>
            </div>

            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={backupAcknowledged}
                onChange={(e) => setBackupAcknowledged(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border accent-primary shrink-0"
              />
              <span className="text-xs text-muted-foreground leading-relaxed">{t('backup.acknowledgement')}</span>
            </label>

            <Button
              type="button"
              onClick={() => {
                setNewMnemonic(null)
                setBackupAcknowledged(false)
              }}
              disabled={!backupAcknowledged}
              className="w-full"
            >
              {t('backup.confirm')}
            </Button>
          </div>
        </div>
      </div>
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
        <div className="mb-4 text-center">
          <div className="flex items-center justify-center gap-2">
            <img src={walletIcon} alt="" className="w-5 h-5" />
            <h1 className="text-xl font-semibold text-foreground">{t('page.title')}</h1>
            {isCreated && (
              <span className="text-xs text-muted-foreground font-mono">{truncateAddress(address, 10, 8)}</span>
            )}
            {isCreated && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 ml-1"
                onClick={handleRefresh}
                title={t('page.refresh')}
                aria-label={t('page.refresh')}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>

        {!isCreated ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <Lottie animationData={explorerAnimation} className="w-24 h-24 mb-3" loop autoplay />
            <div className="text-center">
              <h2 className="text-base font-semibold text-foreground mb-1">{t('page.noWalletTitle')}</h2>
              <p className="text-sm text-muted-foreground max-w-xs">{t('page.noWalletDesc')}</p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="button" onClick={handleCreate} disabled={isLoading} className="w-full max-w-xs">
              {isLoading ? (
                <LoaderCircle className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
              )}
              {t('page.createWallet')}
            </Button>
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
              onSend={() => setActionView('send')}
              onReceive={() => setActionView('receive')}
              t={t}
            />

            {/* Transaction history (always visible — main account history) */}
            <TransactionList transactions={transactions} />
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
  onSend: () => void
  onReceive: () => void
  t: ReturnType<typeof useTranslation>['t']
}

function AccountPanel({ balance, onSend, onReceive, t }: AccountPanelProps) {
  return (
    <div className="mb-6 space-y-3">
      <div className="text-center">
        <p className="text-4xl font-bold text-foreground tracking-tight">
          {formatTonAmount(balance)} <span className="text-2xl font-semibold text-muted-foreground">TON</span>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onSend}
          className="h-9 flex items-center justify-center gap-2 rounded-full bg-surface-hover backdrop-blur-[10px] border border-border-medium text-sm font-medium text-foreground hover:bg-surface-active transition-all duration-200"
        >
          <Send className="h-3.5 w-3.5" />
          {t('tabs.send')}
        </button>
        <button
          type="button"
          onClick={onReceive}
          className="h-9 flex items-center justify-center gap-2 rounded-full bg-surface-hover backdrop-blur-[10px] border border-border-medium text-sm font-medium text-foreground hover:bg-surface-active transition-all duration-200"
        >
          <Download className="h-3.5 w-3.5" />
          {t('tabs.receive')}
        </button>
      </div>
    </div>
  )
}
