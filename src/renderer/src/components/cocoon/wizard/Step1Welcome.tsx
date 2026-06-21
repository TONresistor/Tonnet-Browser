import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getIpcError } from '@/lib/ipc-utils'

interface Props {
  onComplete: (data: { ownerAddress: string; nodeAddress: string; mnemonic: string[] }) => void
}

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
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-2">Welcome to Cocoon AI</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Cocoon runs AI inference inside Intel TDX enclaves on TON. Stake 20 GRAM to use the network. Fully recoverable
          on unstake.
        </p>
      </div>

      <div className="p-4 bg-muted rounded-lg border border-border text-sm text-muted-foreground space-y-2">
        <p className="text-xs font-medium text-foreground">Setup takes about 2 minutes:</p>
        <ol className="list-decimal list-inside space-y-1 pl-1 text-xs">
          <li>Generate a Cocoon wallet</li>
          <li>Back up your 24-word recovery phrase</li>
          <li>Fund the wallet with at least 20 GRAM</li>
          <li>Stake and start the inference client</li>
        </ol>
      </div>

      {error && <div className="p-3 rounded border border-red-500/40 bg-red-500/10 text-red-400 text-sm">{error}</div>}

      <div className="flex justify-end">
        <Button onClick={handleGenerate} disabled={loading} className="min-w-44">
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Generating…
            </>
          ) : (
            'Generate Cocoon Wallet'
          )}
        </Button>
      </div>
    </div>
  )
}
