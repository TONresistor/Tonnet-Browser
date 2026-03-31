/**
 * Wallet page at ton://wallet.
 * Layout: balance + action buttons always visible, transaction history below.
 * Send/Receive triggered via action buttons as inline views.
 */

import { useEffect, useState, useCallback, memo } from 'react'
import { Send, Download, RefreshCw, Plus, LoaderCircle, AlertTriangle, Check, Copy, ArrowLeft } from 'lucide-react'
import Lottie from 'lottie-react'
import explorerAnimation from '@/assets/explorer.json'
import walletIcon from '@/assets/wallet.svg'
import { Button } from '@/components/ui/button'
import { truncateAddress } from '@/lib/format'
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
    init,
    create,
    exportMnemonic,
    send,
    loadHistory,
    refreshBalance,
  } = useWalletStore()
  const [newMnemonic, setNewMnemonic] = useState<string[] | null>(null)
  const [copied, setCopied] = useState(false)
  const [actionView, setActionView] = useState<ActionView>(null)

  useEffect(() => {
    init()
    loadHistory()
  }, [init, loadHistory])

  const handleRefresh = () => {
    refreshBalance()
    loadHistory()
  }

  const handleCreate = useCallback(async () => {
    await create()
    try {
      const words = await exportMnemonic()
      setNewMnemonic(words)
    } catch {
      // wallet created but mnemonic export failed, user can export later from settings
    }
  }, [create, exportMnemonic])

  const handleCopyMnemonic = useCallback(() => {
    if (!newMnemonic) return
    navigator.clipboard.writeText(newMnemonic.join(' '))
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
              <p className="text-sm font-medium text-foreground mb-4">{t('backup.yourPhrase')}</p>
              <div className="grid grid-cols-3 gap-2">
                {newMnemonic.map((word, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg text-sm">
                    <span className="text-muted-foreground w-6 text-right font-mono text-xs">{i + 1}.</span>
                    <span className="font-mono text-foreground">{word}</span>
                  </div>
                ))}
              </div>

              <Button type="button" variant="outline" onClick={handleCopyMnemonic} className="w-full mt-4">
                {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                {copied ? t('export.copied') : t('backup.copy')}
              </Button>
            </div>

            <Button type="button" onClick={() => setNewMnemonic(null)} className="w-full">
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
            {/* Balance: flat, large, single line */}
            <div className="text-center mb-4">
              <p className="text-4xl font-bold text-foreground tracking-tight">
                {formatTonAmount(balance)} <span className="text-2xl font-semibold text-muted-foreground">TON</span>
              </p>
            </div>

            {/* Action buttons */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              <button
                type="button"
                onClick={() => setActionView('send')}
                className="h-9 flex items-center justify-center gap-2 rounded-full bg-surface-hover backdrop-blur-[10px] border border-border-medium text-sm font-medium text-foreground hover:bg-surface-active transition-all duration-200"
              >
                <Send className="h-3.5 w-3.5" />
                {t('tabs.send')}
              </button>
              <button
                type="button"
                onClick={() => setActionView('receive')}
                className="h-9 flex items-center justify-center gap-2 rounded-full bg-surface-hover backdrop-blur-[10px] border border-border-medium text-sm font-medium text-foreground hover:bg-surface-active transition-all duration-200"
              >
                <Download className="h-3.5 w-3.5" />
                {t('tabs.receive')}
              </button>
            </div>

            {/* Transaction history */}
            <TransactionList transactions={transactions} />
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(WalletPage)
