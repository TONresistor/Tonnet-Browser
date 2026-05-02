/**
 * Compact wallet sidebar for the right panel.
 * Shows balance, address, quick actions, and recent transactions.
 * Send and Receive views are inline, no page navigation.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  X,
  Send,
  Download,
  RefreshCw,
  ExternalLink,
  Copy,
  Check,
  ArrowLeft,
  AlertTriangle,
  Eye,
  EyeOff,
} from 'lucide-react'
import walletIcon from '@/assets/wallet.svg'
import { useWalletStore, formatTonAmount } from '@/stores/wallet'
import type { WalletTransaction } from '@shared/types'
import { useTabsStore } from '@/stores/tabs'
import { truncateAddress } from '@/lib/format'
import { TransactionList } from '@/components/wallet/TransactionList'
import { SendForm } from '@/components/wallet/SendForm'
import { ReceivePanel } from '@/components/wallet/ReceivePanel'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { TON_WALLET_PAGE, UI_COPY_FEEDBACK_MS } from '@shared/constants'

type SidebarView = 'overview' | 'send' | 'receive'

interface WalletSidebarProps {
  onClose: () => void
}

export function WalletSidebar({ onClose }: WalletSidebarProps) {
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
    send,
    loadHistory,
    refreshBalance,
  } = useWalletStore()
  const openOrSwitchToTab = useTabsStore((s) => s.openOrSwitchToTab)
  const [copied, setCopied] = useState(false)
  const [mnemonicCopied, setMnemonicCopied] = useState(false)
  const [view, setView] = useState<SidebarView>('overview')
  const [newMnemonic, setNewMnemonic] = useState<string[] | null>(null)
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

  useEffect(() => {
    init()
    loadHistory()
  }, [init, loadHistory])

  const handleRefresh = useCallback(() => {
    refreshBalance()
    loadHistory()
  }, [refreshBalance, loadHistory])

  const handleCopyAddress = useCallback(() => {
    navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), UI_COPY_FEEDBACK_MS)
  }, [address])

  const handleCreate = useCallback(async () => {
    const words = await create()
    if (words) setNewMnemonic(words)
  }, [create])

  const handleCopyMnemonic = useCallback(() => {
    if (!newMnemonic) return
    navigator.clipboard.writeText(newMnemonic.join(' '))
    setTimeout(() => navigator.clipboard.writeText(''), 30_000)
    setMnemonicCopied(true)
    setTimeout(() => setMnemonicCopied(false), UI_COPY_FEEDBACK_MS)
  }, [newMnemonic])

  const handleOpenWallet = useCallback(() => {
    openOrSwitchToTab(TON_WALLET_PAGE)
    onClose()
  }, [openOrSwitchToTab, onClose])

  // Mnemonic backup screen after wallet creation
  if (newMnemonic) {
    return (
      <div className="flex flex-col h-full bg-[hsl(var(--elevation-1))] border-l border-border">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <img src={walletIcon} alt="" className="h-4 w-4" />
          <span className="text-sm font-semibold text-foreground">{t('backup.title')}</span>
        </div>

        <div className="flex-1 overflow-auto px-4 py-4 space-y-4">
          <div className="flex items-start gap-2 p-3 bg-warning/10 border border-warning/20 rounded-lg">
            <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-xs font-medium text-foreground">{t('backup.warning')}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{t('backup.warningDesc')}</p>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-foreground">{t('backup.yourPhrase')}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => setMnemonicRevealed(!mnemonicRevealed)}
            >
              {mnemonicRevealed ? (
                <EyeOff className="h-3 w-3 mr-1" aria-hidden="true" />
              ) : (
                <Eye className="h-3 w-3 mr-1" aria-hidden="true" />
              )}
              {mnemonicRevealed ? t('export.hideButton') : t('export.showButton')}
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {newMnemonic.map((word, i) => (
              <div key={i} className="flex items-center gap-1 px-2 py-1.5 bg-muted rounded text-xs">
                <span className="text-muted-foreground w-4 text-right font-mono text-[10px]">{i + 1}.</span>
                <span className="font-mono text-foreground text-[11px]">
                  {mnemonicRevealed ? word : '\u2022\u2022\u2022\u2022\u2022'}
                </span>
              </div>
            ))}
          </div>

          <Button type="button" variant="outline" size="sm" onClick={handleCopyMnemonic} className="w-full">
            {mnemonicCopied ? <Check className="h-3.5 w-3.5 mr-1.5" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
            {mnemonicCopied ? t('export.copied') : t('backup.copy')}
          </Button>

          <label className="flex items-start gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={backupAcknowledged}
              onChange={(e) => setBackupAcknowledged(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 rounded border-border accent-primary shrink-0"
            />
            <span className="text-[11px] text-muted-foreground leading-relaxed">{t('backup.acknowledgement')}</span>
          </label>

          <Button
            type="button"
            size="sm"
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
    )
  }

  if (!isCreated) {
    return (
      <div className="flex flex-col h-full bg-[hsl(var(--elevation-1))] border-l border-border">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src={walletIcon} alt="" className="h-4 w-4" />
            <span className="text-sm font-semibold text-foreground">{t('page.title')}</span>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Empty state */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-4">
          <img src={walletIcon} alt="" className="h-12 w-12 opacity-40" />
          <div className="text-center">
            <p className="text-sm font-medium text-foreground mb-1">{t('page.noWalletTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('page.noWalletDesc')}</p>
          </div>
          <Button type="button" onClick={handleCreate} disabled={isLoading} className="w-full max-w-[200px]">
            {t('page.createWallet')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-[hsl(var(--elevation-1))]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          {view !== 'overview' ? (
            <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" onClick={() => setView('overview')}>
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <img src={walletIcon} alt="" className="h-4 w-4" />
          )}
          <span className="text-sm font-semibold text-foreground">
            {view === 'overview' ? t('page.title') : view === 'send' ? t('tabs.send') : t('tabs.receive')}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {view === 'overview' && (
            <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" onClick={handleRefresh}>
              <RefreshCw className="h-3 w-3" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {view === 'overview' && (
        <>
          <SidebarOverviewBody
            balance={balance}
            address={address}
            copied={copied}
            handleCopyAddress={handleCopyAddress}
            onSend={() => setView('send')}
            onReceive={() => setView('receive')}
            transactions={transactions}
            t={t}
          />

          {/* Footer */}
          <div className="px-4 py-3 border-t border-border">
            <button
              type="button"
              onClick={handleOpenWallet}
              className="w-full flex items-center justify-center gap-1.5 text-xs text-primary hover:text-primary/80
                transition-colors font-medium"
            >
              <ExternalLink className="h-3 w-3" />
              {t('page.title')}
            </button>
          </div>
        </>
      )}

      {view === 'send' && (
        <div className="flex-1 overflow-auto p-4">
          <SendForm onSend={send} isSending={isSending} error={error} balance={balance} />
        </div>
      )}

      {view === 'receive' && (
        <div className="flex-1 overflow-auto p-4">
          <ReceivePanel address={address} />
        </div>
      )}
    </div>
  )
}

interface SidebarOverviewBodyProps {
  balance: string
  address: string
  copied: boolean
  handleCopyAddress: () => void
  onSend: () => void
  onReceive: () => void
  transactions: WalletTransaction[]
  t: ReturnType<typeof useTranslation>['t']
}

function SidebarOverviewBody({
  balance,
  address,
  copied,
  handleCopyAddress,
  onSend,
  onReceive,
  transactions,
  t,
}: SidebarOverviewBodyProps) {
  return (
    <>
      <div className="px-4 pt-3 pb-2 text-center">
        <p className="text-3xl font-bold text-foreground tracking-tight">{formatTonAmount(balance)}</p>
        <p className="text-xs text-muted-foreground mt-0.5">TON</p>
      </div>

      <div className="px-4 pb-3">
        <button
          type="button"
          onClick={handleCopyAddress}
          className="w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground
            hover:text-foreground transition-colors font-mono"
          title={address}
        >
          <span>{truncateAddress(address, 8, 6)}</span>
          {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>

      <div className="px-4 pb-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onSend}
          className="h-10 flex items-center justify-center gap-1.5 rounded-full bg-surface-hover
            border border-border-medium text-sm font-medium text-foreground hover:bg-surface-active
            transition-all duration-150"
        >
          <Send className="h-3.5 w-3.5" />
          {t('tabs.send')}
        </button>
        <button
          type="button"
          onClick={onReceive}
          className="h-10 flex items-center justify-center gap-1.5 rounded-full bg-surface-hover
            border border-border-medium text-sm font-medium text-foreground hover:bg-surface-active
            transition-all duration-150"
        >
          <Download className="h-3.5 w-3.5" />
          {t('tabs.receive')}
        </button>
      </div>

      <div className="border-t border-border mt-1" />
      <div className="flex-1 overflow-auto min-h-0 px-3">
        <div className="py-3">
          <h3 className="text-xs font-medium text-muted-foreground mb-2 px-1">{t('overview.recent')}</h3>
          <TransactionList transactions={transactions} />
        </div>
      </div>
    </>
  )
}
