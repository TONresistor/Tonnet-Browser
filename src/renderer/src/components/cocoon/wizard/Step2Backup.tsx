import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Copy, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  mnemonic: string[]
  onComplete: () => void
  onBack: () => void
}

export function Step2Backup({ mnemonic, onComplete, onBack }: Props) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(mnemonic.join(' '))
    setCopied(true)
    copyTimerRef.current = setTimeout(() => {
      setCopied(false)
      navigator.clipboard.writeText('').catch(() => {})
    }, 30_000)
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">Step 2: Back up your recovery phrase</h2>
        <p className="text-sm text-muted-foreground">
          Write down all 24 words in order. This is the only way to recover your wallet.
        </p>
      </div>

      <div className="flex items-start gap-2 p-3 bg-warning/10 border border-warning/20 rounded-lg">
        <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" aria-hidden="true" />
        <div>
          <p className="text-xs font-medium text-foreground">Never share your recovery phrase</p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Anyone with these 24 words has full control of your wallet. Store them offline in a safe place.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-foreground">Your recovery phrase</p>
        <Button type="button" variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setRevealed(!revealed)}>
          {revealed ? (
            <EyeOff className="h-3 w-3 mr-1" aria-hidden="true" />
          ) : (
            <Eye className="h-3 w-3 mr-1" aria-hidden="true" />
          )}
          {revealed ? 'Hide' : 'Show'}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {mnemonic.map((word, i) => (
          <div key={i} className="flex items-center gap-1 px-2 py-1.5 bg-muted rounded text-xs">
            <span className="text-muted-foreground w-4 text-right font-mono text-[10px]">{i + 1}.</span>
            <span className="font-mono text-foreground text-[11px]">{revealed ? word : '•••••'}</span>
          </div>
        ))}
      </div>

      <Button type="button" variant="outline" size="sm" onClick={handleCopy} className="w-full">
        {copied ? <Check className="h-3.5 w-3.5 mr-1.5" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
        {copied ? 'Copied, clears in 30s' : 'Copy phrase'}
      </Button>

      <label className="flex items-start gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 rounded border-border accent-primary shrink-0"
        />
        <span className="text-[11px] text-muted-foreground leading-relaxed">
          I have safely backed up my recovery phrase and understand it cannot be recovered if lost.
        </span>
      </label>

      <div className="flex justify-between pt-1">
        <Button type="button" variant="outline" size="sm" onClick={onBack}>
          Back
        </Button>
        <Button type="button" size="sm" onClick={onComplete} disabled={!acknowledged}>
          Continue
        </Button>
      </div>
    </div>
  )
}
