import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, Copy, LoaderCircle } from 'lucide-react'
import type { ZkResistorPool } from '@shared/types'
import gramIcon from '@/assets/gram.svg'
import { ActionButton } from '@/components/ui/ios/ActionButton'
import { InsetGroup } from '@/components/ui/ios/InsetGroup'
import { Segmented } from '@/components/ui/ios/Segmented'
import { browserNavigation } from '@/features/browser/navigation'
import { useWalletStore } from '@/features/wallet/store'
import { formatTokenUnits } from '../format'
import { useZkResistorCatalog } from '../useCatalog'

export default function ZkResistorPoolPage({ poolAddress }: { poolAddress: string }) {
  const { catalog, loading, error, reload } = useZkResistorCatalog()
  const pool = catalog?.pools.find((candidate) => candidate.address === poolAddress) ?? null

  return (
    <div className="h-full overflow-auto bg-background-secondary" style={{ fontFamily: 'Inter, sans-serif' }}>
      <main className="mx-auto max-w-2xl px-5 py-6">
        <button
          type="button"
          onClick={() => browserNavigation.navigateActiveTab('ton://zkr')}
          className="mb-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:opacity-80"
        >
          <ArrowLeft className="h-4 w-4" />
          Pools
        </button>

        {loading && !catalog && (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
            <LoaderCircle className="h-5 w-5 animate-spin" />
            Reading Pool
          </div>
        )}

        {error && (
          <div className="rounded-card border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {catalog && !pool && !error && (
          <div className="py-20 text-center text-sm text-muted-foreground">Pool not found</div>
        )}

        {pool && <PoolContent key={pool.address} pool={pool} onCatalogChanged={reload} />}
      </main>
    </div>
  )
}

function PoolContent({ pool, onCatalogChanged }: { pool: ZkResistorPool; onCatalogChanged: () => Promise<void> }) {
  return (
    <>
      <header className="mb-6 flex items-center gap-3 px-1">
        <img src={gramIcon} alt="GRAM" className="h-12 w-12 shrink-0" />
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-heading">
            {formatTokenUnits(pool.denomination, pool.decimals)} {pool.symbol}
          </h1>
          <p className="text-[13px] text-muted-foreground">GRAM privacy pool</p>
        </div>
      </header>

      <InsetGroup title="Pool overview" bodyClassName="divide-y divide-border-subtle">
        <OverviewRow
          label="Total shielded"
          value={`${formatTokenUnits(pool.shieldedAmount, pool.decimals)} ${pool.symbol}`}
        />
        <OverviewRow label="Privacy set" value={pool.shieldedDeposits.toLocaleString()} />
        <OverviewRow label="Deposits" value={pool.nextIndex.toLocaleString()} />
        <OverviewRow label="Withdrawals" value={pool.withdrawalCount.toLocaleString()} />
      </InsetGroup>

      <PrivateActions pool={pool} onCatalogChanged={onCatalogChanged} />
    </>
  )
}

function PrivateActions({ pool, onCatalogChanged }: { pool: ZkResistorPool; onCatalogChanged: () => Promise<void> }) {
  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [preparedId, setPreparedId] = useState<string | null>(null)
  const [secretNote, setSecretNote] = useState('')
  const [noteSaved, setNoteSaved] = useState(false)
  const [depositSubmitted, setDepositSubmitted] = useState(false)
  const [copied, setCopied] = useState(false)
  const [withdrawNote, setWithdrawNote] = useState('')
  const [recipient, setRecipient] = useState('')
  const active = useRef(true)
  const initWallet = useWalletStore((state) => state.init)
  const walletCreated = useWalletStore((state) => state.isCreated)
  const walletAddress = useWalletStore((state) => state.address)
  const walletLocked = useWalletStore((state) => state.isLocked)
  const needsPasswordSetup = useWalletStore((state) => state.needsPasswordSetup)
  const backupVerified = useWalletStore((state) => state.backupVerified)

  useEffect(() => {
    void initWallet()
  }, [initWallet])

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])

  useEffect(() => {
    if (!recipient && walletAddress) setRecipient(walletAddress)
  }, [recipient, walletAddress])

  useEffect(() => {
    if (!preparedId) return
    return () => {
      void import('../private-runtime').then((runtime) => runtime.discardPreparedDeposit(preparedId))
    }
  }, [preparedId])

  const walletIssue = useMemo(() => {
    if (!walletCreated) return 'Create a wallet before using this Pool.'
    if (needsPasswordSetup) return 'Set your wallet password before using this Pool.'
    if (walletLocked) return 'Unlock your wallet before using this Pool.'
    if (!backupVerified) return 'Verify your wallet backup before using this Pool.'
    return null
  }, [backupVerified, needsPasswordSetup, walletCreated, walletLocked])

  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      await operation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ZKResistor operation failed')
    } finally {
      setBusy(false)
      setPhase('')
    }
  }

  const prepareDeposit = () =>
    run(async () => {
      if (walletIssue) throw new Error(walletIssue)
      const runtime = await import('../private-runtime')
      const prepared = await runtime.prepareGramDeposit(pool, walletAddress, setPhase)
      if (!active.current) {
        runtime.discardPreparedDeposit(prepared.id)
        return
      }
      setPreparedId(prepared.id)
      setSecretNote(prepared.note)
      setNoteSaved(false)
      setDepositSubmitted(false)
      setCopied(false)
    })

  const submitDeposit = () =>
    run(async () => {
      if (walletIssue) throw new Error(walletIssue)
      if (!preparedId || !noteSaved) throw new Error('Save and confirm the secret note before depositing')
      const runtime = await import('../private-runtime')
      try {
        await runtime.submitGramDeposit(preparedId, walletAddress, setPhase)
      } catch (cause) {
        setPreparedId(null)
        setSecretNote('')
        setNoteSaved(false)
        setCopied(false)
        throw cause
      }
      setPreparedId(null)
      setNoteSaved(false)
      setDepositSubmitted(true)
      setSuccess('Deposit submitted.')
      void onCatalogChanged()
    })

  const submitWithdraw = () =>
    run(async () => {
      if (walletIssue) throw new Error(walletIssue)
      if (!withdrawNote.trim()) throw new Error('Enter your secret note')
      if (!recipient.trim()) throw new Error('Enter a recipient address')
      const runtime = await import('../private-runtime')
      await runtime.withdrawGram(pool, withdrawNote, recipient, setPhase)
      setWithdrawNote('')
      setSuccess('Withdrawal submitted.')
      void onCatalogChanged()
    })

  const copyNote = async () => {
    await navigator.clipboard.writeText(secretNote)
    setCopied(true)
  }

  return (
    <InsetGroup title="Private action" className="mt-5" bodyClassName="p-4">
      <div>
        <Segmented
          value={mode}
          onChange={(next) => {
            setMode(next)
            setError(null)
            setSuccess(null)
          }}
          options={[
            { value: 'deposit', label: 'Deposit' },
            { value: 'withdraw', label: 'Withdraw' },
          ]}
          disabled={busy}
          fullWidth
          ariaLabel="Private Pool action"
        />

        {mode === 'deposit' ? (
          <div className="mt-4 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Deposit {formatTokenUnits(pool.denomination, pool.decimals)} GRAM
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Generate and save your secret note before approving the deposit.
              </p>
            </div>

            {!secretNote ? (
              <ActionButton
                variant="filled"
                className="w-full"
                disabled={busy || Boolean(walletIssue)}
                onClick={prepareDeposit}
              >
                Generate secret note
              </ActionButton>
            ) : (
              <>
                <div className="rounded-card border border-border-subtle bg-background-secondary p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-foreground">Secret note</span>
                    <button
                      type="button"
                      onClick={copyNote}
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:opacity-80"
                    >
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="break-all font-mono text-[11px] leading-relaxed text-muted-foreground">{secretNote}</p>
                </div>
                {depositSubmitted ? (
                  <ActionButton
                    variant="filled"
                    className="w-full"
                    disabled={busy || Boolean(walletIssue)}
                    onClick={prepareDeposit}
                  >
                    New deposit
                  </ActionButton>
                ) : (
                  <>
                    <label className="flex cursor-pointer select-none items-start gap-2 rounded-card border border-border-subtle bg-elevation-2 p-3">
                      <input
                        type="checkbox"
                        checked={noteSaved}
                        disabled={busy}
                        onChange={(event) => setNoteSaved(event.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary"
                      />
                      <span className="text-xs leading-relaxed text-muted-foreground">
                        I saved this note. It is required to withdraw the deposit.
                      </span>
                    </label>
                    <ActionButton
                      variant="filled"
                      className="w-full"
                      disabled={busy || !noteSaved || Boolean(walletIssue)}
                      onClick={submitDeposit}
                    >
                      Deposit {formatTokenUnits(pool.denomination, pool.decimals)} GRAM
                    </ActionButton>
                  </>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Withdraw {formatTokenUnits(pool.denomination, pool.decimals)} GRAM
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                The wallet pays the transaction gas. The private funds go to the recipient below.
              </p>
            </div>
            <label className="block space-y-2">
              <span className="text-xs font-medium text-foreground">Secret note</span>
              <textarea
                value={withdrawNote}
                onChange={(event) => setWithdrawNote(event.target.value)}
                rows={4}
                spellCheck={false}
                autoComplete="off"
                placeholder="Paste your ZKResistor note"
                className="w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 font-mono text-xs text-foreground placeholder:font-sans placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </label>
            <label className="block space-y-2">
              <span className="text-xs font-medium text-foreground">Recipient</span>
              <input
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                spellCheck={false}
                autoComplete="off"
                placeholder="UQ... or EQ..."
                className="h-10 w-full rounded-full border border-input bg-transparent px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </label>
            <ActionButton
              variant="filled"
              className="w-full"
              disabled={busy || !withdrawNote.trim() || !recipient.trim() || Boolean(walletIssue)}
              onClick={submitWithdraw}
            >
              Withdraw
            </ActionButton>
          </div>
        )}

        {walletIssue && <p className="mt-3 text-xs text-muted-foreground">{walletIssue}</p>}
        {busy && (
          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            {phase || 'Preparing'}
          </p>
        )}
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        {success && <p className="mt-3 text-center text-xs text-success">{success}</p>}
      </div>
    </InsetGroup>
  )
}

function OverviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 px-4 py-3">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <strong className="text-[13px] font-semibold text-foreground tabular-nums">{value}</strong>
    </div>
  )
}
