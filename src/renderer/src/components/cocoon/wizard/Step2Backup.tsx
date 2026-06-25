import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ActionButton } from '@/components/ui/ios/ActionButton'
import { cn } from '@/lib/utils'

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
    <div className="space-y-5">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-foreground">Back up your recovery phrase</h2>
        <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted-foreground">
          Write the 24 words down and keep them offline. Anyone with them controls your wallet.
        </p>
      </div>

      <div className="rounded-card border border-border-subtle bg-elevation-2 p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-medium text-foreground">Your recovery phrase</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={() => setRevealed(!revealed)}
          >
            {revealed ? (
              <EyeOff className="mr-1 h-3 w-3" aria-hidden="true" />
            ) : (
              <Eye className="mr-1 h-3 w-3" aria-hidden="true" />
            )}
            {revealed ? 'Hide' : 'Show'}
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          {mnemonic.map((word, i) => (
            <div key={i} className="flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1.5 text-xs">
              <span className="w-4 text-right font-mono text-[10px] text-muted-foreground">{i + 1}</span>
              <span className="font-mono text-[11px] text-foreground">{revealed ? word : '•••••'}</span>
            </div>
          ))}
        </div>

        <ActionButton
          variant="gray"
          onClick={handleCopy}
          className="mt-3 w-full"
          icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        >
          {copied ? 'Copied, clears in 30s' : 'Copy phrase'}
        </ActionButton>
      </div>

      <label className="group flex cursor-pointer select-none items-start gap-3">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="peer sr-only"
        />
        <span
          className={cn(
            'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-1',
            acknowledged
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border-medium bg-surface group-hover:border-border-strong'
          )}
        >
          {acknowledged && <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />}
        </span>
        <span className="text-[12px] leading-relaxed text-muted-foreground">
          I have safely backed up my recovery phrase and understand it cannot be recovered if lost.
        </span>
      </label>

      <div className="flex gap-3">
        <ActionButton variant="gray" onClick={onBack} className="flex-1">
          Back
        </ActionButton>
        <ActionButton variant="filled" onClick={onComplete} disabled={!acknowledged} className="flex-1">
          Continue
        </ActionButton>
      </div>
    </div>
  )
}
