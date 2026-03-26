/**
 * Wallet page at ton://wallet.
 * Full wallet UI with tabs: Overview, Send, Receive, History.
 * Supports mnemonic import/export for compatibility with Tonkeeper/MyTonWallet.
 */

import { useEffect, useState, useCallback, memo } from 'react'
import {
  Send,
  Download,
  History,
  RefreshCw,
  Plus,
  LoaderCircle,
  AlertTriangle,
  Check,
  Copy,
  Globe,
  ImageIcon,
} from 'lucide-react'
import Lottie from 'lottie-react'
import explorerAnimation from '@/assets/explorer.json'
import walletIcon from '@/assets/wallet.svg'
import { Button } from '@/components/ui/button'
import { truncateAddress } from '@/lib/format'
import { useWalletStore, formatTonAmount } from '@/stores/wallet'
import { SendForm } from '@/components/wallet/SendForm'
import { ReceivePanel } from '@/components/wallet/ReceivePanel'
import { TransactionList } from '@/components/wallet/TransactionList'
import { DnsTab } from '@/components/wallet/DnsTab'
import { NftGrid } from '@/components/wallet/NftGrid'
import { cn } from '@/lib/utils'
import { UI_COPY_FEEDBACK_MS } from '@shared/constants'
import { useTranslation } from 'react-i18next'

type Tab = 'overview' | 'send' | 'receive' | 'history' | 'dns' | 'nft'

const TABS: { id: Tab; label?: string; labelKey?: string; Icon: React.ElementType }[] = [
  {
    id: 'overview',
    labelKey: 'tabs.overview',
    Icon: ({ className }: { className?: string }) => <img src={walletIcon} alt="" className={className} />,
  },
  { id: 'send', labelKey: 'tabs.send', Icon: Send },
  { id: 'receive', labelKey: 'tabs.receive', Icon: Download },
  { id: 'history', labelKey: 'tabs.history', Icon: History },
  { id: 'dns', label: 'TON DNS', Icon: Globe },
  { id: 'nft', label: 'NFT', Icon: ImageIcon },
]

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
    activeTab,
    setActiveTab,
  } = useWalletStore()
  const [newMnemonic, setNewMnemonic] = useState<string[] | null>(null)
  const [copied, setCopied] = useState(false)

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
          {/* Inline header */}
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
          <>
            {/* Tab nav */}
            <div className="flex justify-center mb-4 mx-auto w-fit border-b border-border">
              {TABS.map(({ id, label, labelKey, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={cn(
                    'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors',
                    activeTab === id
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  )}
                  aria-selected={activeTab === id}
                  role="tab"
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {label || t(labelKey!)}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div>
              {activeTab === 'overview' && (
                <div className="max-w-lg mx-auto space-y-3">
                  {/* Balance card */}
                  <div className="bg-card/85 backdrop-blur-[20px] rounded-2xl border border-border p-5 text-center shadow-[0_8px_32px_hsl(var(--shadow-color)/0.15)]">
                    <p className="text-xs text-muted-foreground mb-1">{t('overview.balance')}</p>
                    <p className="text-3xl font-bold text-foreground tracking-tight">{formatTonAmount(balance)}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">TON</p>
                  </div>

                  {/* Quick actions */}
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setActiveTab('send')}
                      className="h-9 flex-1 flex items-center justify-center gap-2 rounded-full bg-surface-hover backdrop-blur-[10px] border border-border-medium text-sm font-medium text-foreground hover:bg-surface-active transition-all duration-200"
                    >
                      <Send className="h-3.5 w-3.5" />
                      {t('tabs.send')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('receive')}
                      className="h-9 flex-1 flex items-center justify-center gap-2 rounded-full bg-surface-hover backdrop-blur-[10px] border border-border-medium text-sm font-medium text-foreground hover:bg-surface-active transition-all duration-200"
                    >
                      <Download className="h-3.5 w-3.5" />
                      {t('tabs.receive')}
                    </button>
                  </div>

                  {/* Recent transactions */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium text-foreground">{t('overview.recent')}</h3>
                      {transactions.length > 5 && (
                        <button
                          type="button"
                          className="text-xs text-primary hover:underline"
                          onClick={() => setActiveTab('history')}
                        >
                          {t('overview.viewAll')}
                        </button>
                      )}
                    </div>
                    <div className="glass-card px-3">
                      <TransactionList transactions={transactions.slice(0, 5)} />
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'send' && (
                <div className="max-w-md mx-auto">
                  <div className="glass-card p-4">
                    <SendForm onSend={send} isSending={isSending} error={error} balance={balance} />
                  </div>
                </div>
              )}

              {activeTab === 'receive' && (
                <div className="max-w-md mx-auto">
                  <div className="glass-card p-4">
                    <ReceivePanel address={address} />
                  </div>
                </div>
              )}

              {activeTab === 'history' && (
                <div className="max-w-lg mx-auto">
                  <div className="glass-card px-3">
                    <TransactionList transactions={transactions} />
                  </div>
                </div>
              )}

              {activeTab === 'dns' && (
                <div className="max-w-lg mx-auto">
                  <DnsTab />
                </div>
              )}

              {activeTab === 'nft' && (
                <div className="max-w-lg mx-auto">
                  <NftGrid />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default memo(WalletPage)
