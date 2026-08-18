/**
 * Compact wallet sidebar for the right panel.
 * Shows balance, address, quick actions, and recent transactions.
 * Send and Receive views are inline, no page navigation.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  X,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  ExternalLink,
  Copy,
  Check,
  ArrowLeft,
  AlertTriangle,
  Eye,
  EyeOff,
} from 'lucide-react'
import { AppIcon } from '@/components/ui/AppIcon'
import { useWalletStore } from '@/features/wallet/store'
import { formatTonAmount } from '@/lib/ton-utils'
import type { WalletTransaction } from '@shared/types'
import { useOpenOrSwitchBrowserTab } from '@/features/browser/navigation'
import { TransactionList } from '@/features/wallet/components/TransactionList'
import { SendForm } from '@/features/wallet/components/SendForm'
import { ReceivePanel } from '@/features/wallet/components/ReceivePanel'
import { TransactionDetailSheet } from '@/features/wallet/components/TransactionDetailSheet'
import { ActionButton } from '@/components/ui/ios/ActionButton'
import { ActionTile } from '@/components/ui/ios/ActionTile'
import { BalanceHero } from '@/components/ui/ios/BalanceHero'
import { InsetGroup } from '@/components/ui/ios/InsetGroup'
import { EmptyState } from '@/components/ui/ios/EmptyState'
import { AddressChip } from '@/components/ui/ios/AddressChip'
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
    isLocked,
    needsPasswordSetup,
    backupVerified,
    init,
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
      isLocked: s.isLocked,
      needsPasswordSetup: s.needsPasswordSetup,
      backupVerified: s.backupVerified,
      init: s.init,
      send: s.send,
      loadHistory: s.loadHistory,
      refreshBalance: s.refreshBalance,
    }))
  )
  const openOrSwitchToTab = useOpenOrSwitchBrowserTab()
  const [mnemonicCopied, setMnemonicCopied] = useState(false)
  const [view, setView] = useState<SidebarView>('overview')
  const [selectedTx, setSelectedTx] = useState<WalletTransaction | null>(null)
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

  const handleCreate = useCallback(async () => {
    openOrSwitchToTab(TON_WALLET_PAGE)
    onClose()
  }, [openOrSwitchToTab, onClose])

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
          <AppIcon name="wallet" className="h-4 w-4 text-icon" />
          <span className="text-sm font-semibold text-heading">{t('backup.title')}</span>
        </div>

        <div className="flex-1 overflow-auto px-4 py-4 space-y-4">
          <div className="flex items-start gap-2 rounded-card border border-warning/20 bg-warning/10 p-3">
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
              <div key={i} className="flex items-center gap-1 rounded-control bg-muted px-2 py-1.5 text-xs">
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
            <AppIcon name="wallet" className="h-4 w-4 text-icon" />
            <span className="text-sm font-semibold text-heading">{t('page.title')}</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-full"
            onClick={onClose}
            title={t('page.close', { defaultValue: 'Close' })}
            aria-label={t('page.close', { defaultValue: 'Close' })}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>

        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={<AppIcon name="wallet" className="h-7 w-7 text-icon opacity-70" />}
            title={t('page.noWalletTitle')}
            description={t('page.noWalletDesc')}
            action={
              <ActionButton
                variant="filled"
                onClick={handleCreate}
                disabled={isLoading}
                className="w-full max-w-[200px]"
              >
                {t('page.createWallet')}
              </ActionButton>
            }
          />
        </div>
      </div>
    )
  }

  if (isLocked || needsPasswordSetup || !backupVerified) {
    return (
      <div className="flex h-full flex-col bg-[hsl(var(--elevation-1))] border-l border-border">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AppIcon name="wallet" className="h-4 w-4 text-icon" />
            <span className="text-sm font-semibold text-heading">{t('page.title')}</span>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" onClick={onClose}>
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <EmptyState
            icon={<AppIcon name="wallet" className="h-7 w-7 text-icon opacity-70" />}
            title={needsPasswordSetup ? 'Protect wallet' : isLocked ? 'Wallet locked' : 'Verify wallet backup'}
            description="Open the wallet page to continue securely."
            action={
              <ActionButton variant="filled" onClick={handleOpenWallet} className="w-full max-w-[200px]">
                Open wallet
              </ActionButton>
            }
          />
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
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 rounded-full"
              onClick={() => setView('overview')}
              title={t('send.back')}
              aria-label={t('send.back')}
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          ) : (
            <AppIcon name="wallet" className="h-4 w-4 text-icon" />
          )}
          <span className="text-sm font-semibold text-heading">
            {view === 'overview' ? t('page.title') : view === 'send' ? t('tabs.send') : t('tabs.receive')}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {view === 'overview' && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 rounded-full"
              onClick={handleRefresh}
              title={t('page.refresh')}
              aria-label={t('page.refresh')}
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-full"
            onClick={onClose}
            title={t('page.close', { defaultValue: 'Close' })}
            aria-label={t('page.close', { defaultValue: 'Close' })}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {view === 'overview' && (
        <>
          <SidebarOverviewBody
            balance={balance}
            address={address}
            onSend={() => setView('send')}
            onReceive={() => setView('receive')}
            transactions={transactions}
            onSelect={setSelectedTx}
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

      <TransactionDetailSheet tx={selectedTx} selfAddress={address} onClose={() => setSelectedTx(null)} />
    </div>
  )
}

interface SidebarOverviewBodyProps {
  balance: string
  address: string
  onSend: () => void
  onReceive: () => void
  transactions: WalletTransaction[]
  onSelect: (tx: WalletTransaction) => void
  t: ReturnType<typeof useTranslation>['t']
}

function SidebarOverviewBody({
  balance,
  address,
  onSend,
  onReceive,
  transactions,
  onSelect,
  t,
}: SidebarOverviewBodyProps) {
  return (
    <>
      <div className="px-4 pb-4 pt-4">
        <BalanceHero amount={formatTonAmount(balance)} unit="GRAM" size="lg">
          <AddressChip address={address} startChars={8} endChars={6} />
        </BalanceHero>
      </div>

      <div className="flex justify-center gap-3 px-4 pb-4">
        <ActionTile icon={<ArrowUp className="h-6 w-6" strokeWidth={2.5} />} label={t('tabs.send')} onClick={onSend} />
        <ActionTile
          icon={<ArrowDown className="h-6 w-6" strokeWidth={2.5} />}
          label={t('tabs.receive')}
          onClick={onReceive}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
        <InsetGroup title={t('overview.recent')} bodyClassName="py-1">
          <TransactionList transactions={transactions} onSelect={onSelect} compact />
        </InsetGroup>
      </div>
    </>
  )
}
