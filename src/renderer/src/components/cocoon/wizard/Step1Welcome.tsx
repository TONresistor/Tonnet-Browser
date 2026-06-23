import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { getIpcError } from '@/lib/ipc-utils'
import { ActionButton } from '@/components/ui/ios/ActionButton'
import { InsetGroup } from '@/components/ui/ios/InsetGroup'
import cocoonIcon from '@/assets/cocoon.png'

interface Props {
  onComplete: (data: { ownerAddress: string; nodeAddress: string; mnemonic: string[] }) => void
}

const SETUP_STEPS = ['Generate wallet', 'Back up recovery phrase', 'Fund 20 GRAM', 'Stake & start']

export function Step1Welcome({ onComplete }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleGenerate = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.electron.cocoon.walletCreate()
      const err = getIpcError(result)
      if (err) {
        setError(err)
        setLoading(false)
        return
      }
      onComplete(result)
    } catch (err) {
      setError((err as Error).message ?? 'Failed to create wallet')
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <img src={cocoonIcon} alt="" className="h-12 w-12" />
        <div>
          <h2 className="text-lg font-semibold text-foreground">Welcome to Cocoon AI</h2>
          <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
            Connect to the Cocoon AI network.
          </p>
        </div>
      </div>

      <InsetGroup title="Setup takes about 2 minutes">
        {SETUP_STEPS.map((label, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-border-subtle px-4 py-2.5 last:border-0">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface text-xs font-semibold text-muted-foreground tabular-nums">
              {i + 1}
            </span>
            <span className="text-[14px] text-foreground">{label}</span>
          </div>
        ))}
      </InsetGroup>

      {error && (
        <div className="rounded-card border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}

      <ActionButton
        variant="filled"
        onClick={handleGenerate}
        disabled={loading}
        className="w-full"
        icon={loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      >
        {loading ? 'Generating…' : 'Generate Cocoon Wallet'}
      </ActionButton>
    </div>
  )
}
