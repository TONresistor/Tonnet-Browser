import { useState } from 'react'
import { cocoonClient } from '@/features/cocoon/client'
import { AlertTriangle, Check, Copy, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatTonFixed } from '@/lib/ton-utils'
import { decideReset } from './reset-gate'

/**
 * Escape hatch for a wizard stuck in resume mode (wallet created earlier, never
 * funded, mnemonic never saved → the Fund/Stake steps have no Back). Lets the
 * user delete the unfinished Cocoon wallet and start a fresh setup.
 *
 * Balance-gated for safety: if the owner address holds funds, we refuse to make
 * deletion easy and surface the recovery phrase first (deleting the local key
 * loses the funds otherwise). Only shown in resume mode by SetupWizard.
 */

type Phase = 'idle' | 'checking' | 'confirmEmpty' | 'warnFunded' | 'phrase' | 'deleting'

export function StartOverControl({ onReset }: { onReset: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [ownerBalance, setOwnerBalance] = useState<string | null>(null)
  const [verifyFailed, setVerifyFailed] = useState(false)
  const [mnemonic, setMnemonic] = useState<string[] | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const begin = async () => {
    setError(null)
    setVerifyFailed(false)
    setPhase('checking')
    let result: unknown
    try {
      result = await cocoonClient.getOwnerBalance()
    } catch {
      // Can't read the balance — be conservative and treat as possibly funded.
      setVerifyFailed(true)
      setPhase('warnFunded')
      return
    }
    const decision = decideReset(result)
    setOwnerBalance(decision.balanceNano)
    setVerifyFailed(decision.verifyFailed)
    setPhase(decision.phase)
  }

  const viewPhrase = async () => {
    setError(null)
    try {
      const res = await cocoonClient.walletExportMnemonic()
      setMnemonic(res as string[])
      setPhase('phrase')
    } catch (error) {
      setError((error as Error).message ?? 'Unable to export recovery phrase')
    }
  }

  const copyPhrase = async () => {
    if (!mnemonic) return
    await navigator.clipboard.writeText(mnemonic.join(' '))
    setCopied(true)
    setTimeout(() => setCopied(false), 3_000)
  }

  const doDelete = async () => {
    setError(null)
    setPhase('deleting')
    try {
      await cocoonClient.walletDelete()
      // Wallet file gone → parent refresh() re-derives to needsSetup (fresh wizard).
      onReset()
    } catch (error) {
      setError((error as Error).message ?? 'Unable to reset Cocoon wallet')
      setPhase('idle')
    }
  }

  if (phase === 'idle') {
    return (
      <div className="border-t border-border pt-3 text-center">
        <button
          type="button"
          onClick={begin}
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Start setup over
        </button>
      </div>
    )
  }

  if (phase === 'checking' || phase === 'deleting') {
    return (
      <div className="flex items-center justify-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {phase === 'deleting' ? 'Deleting wallet…' : 'Checking balance…'}
      </div>
    )
  }

  if (phase === 'confirmEmpty') {
    return (
      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-xs text-muted-foreground">
          This Cocoon wallet was never funded, so nothing is lost. Delete it and start a fresh setup?
        </p>
        {error && <p className="text-[11px] text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setPhase('idle')}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" size="sm" onClick={doDelete}>
            Delete & start over
          </Button>
        </div>
      </div>
    )
  }

  if (phase === 'warnFunded') {
    return (
      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex items-start gap-2 rounded-lg border border-warning/20 bg-warning/10 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <div>
            <p className="text-xs font-medium text-foreground">
              {verifyFailed
                ? "Couldn't verify this wallet's balance."
                : `This wallet holds ${formatTonFixed(ownerBalance!)} GRAM.`}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Deleting it loses the funds unless you have the 24-word recovery phrase. View and save it first.
            </p>
          </div>
        </div>
        {error && <p className="text-[11px] text-red-400">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setPhase('idle')}>
            Cancel
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={viewPhrase}>
            View recovery phrase
          </Button>
          <Button type="button" variant="destructive" size="sm" onClick={doDelete}>
            Delete anyway
          </Button>
        </div>
      </div>
    )
  }

  // phase === 'phrase'
  return (
    <div className="space-y-3 border-t border-border pt-3">
      <p className="text-xs font-medium text-foreground">Recovery phrase — write down all 24 words before deleting.</p>
      <div className="grid grid-cols-3 gap-1.5">
        {mnemonic!.map((word, i) => (
          <div key={i} className="flex items-center gap-1 rounded bg-muted px-2 py-1.5 text-xs">
            <span className="w-4 text-right font-mono text-[10px] text-muted-foreground">{i + 1}.</span>
            <span className="font-mono text-[11px] text-foreground">{word}</span>
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={copyPhrase} className="w-full">
        {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
        {copied ? 'Copied' : 'Copy phrase'}
      </Button>
      {error && <p className="text-[11px] text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setPhase('warnFunded')}>
          Back
        </Button>
        <Button type="button" variant="destructive" size="sm" onClick={doDelete}>
          I saved it — delete & start over
        </Button>
      </div>
    </div>
  )
}
