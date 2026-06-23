import { useCallback, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { truncateAddress } from '@/lib/format'
import { UI_COPY_FEEDBACK_MS } from '@shared/constants'

interface AddressChipProps {
  address: string
  startChars?: number
  endChars?: number
  full?: boolean
  label?: string
  copiedLabel?: string
  className?: string
}

export function AddressChip({
  address,
  startChars = 6,
  endChars = 6,
  full,
  label = 'Copy address',
  copiedLabel = 'Address copied',
  className,
}: AddressChipProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), UI_COPY_FEEDBACK_MS)
  }, [address])

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={address}
      aria-label={label}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground',
        full && 'max-w-full whitespace-normal break-all rounded-card',
        className
      )}
    >
      <span>{full ? address : truncateAddress(address, startChars, endChars)}</span>
      {copied ? (
        <Check className="h-3 w-3 text-success" aria-hidden="true" />
      ) : (
        <Copy className="h-3 w-3" aria-hidden="true" />
      )}
      <span className="sr-only" aria-live="polite">
        {copied ? copiedLabel : ''}
      </span>
    </button>
  )
}
