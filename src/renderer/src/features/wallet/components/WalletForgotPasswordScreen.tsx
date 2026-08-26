import { useState } from 'react'
import { AlertTriangle, ArrowLeft, RotateCcw, Upload, X } from 'lucide-react'
import { errorMessage } from '@shared/errors'
import { AppIcon } from '@/components/ui/AppIcon'
import { ActionButton } from '@/components/ui/ios/ActionButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export function WalletForgotPasswordScreen({
  compact = false,
  onRecover,
  onForget,
  onBack,
  onClose,
}: {
  compact?: boolean
  onRecover: () => void
  onForget: () => Promise<void>
  onBack: () => void
  onClose?: () => void
}) {
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleForget = async () => {
    setPending(true)
    setError(null)
    try {
      await onForget()
      onBack()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  const handleRecover = () => {
    onRecover()
    onBack()
  }

  const content = (
    <div
      className={cn(
        'w-full space-y-4',
        compact ? 'max-w-xs text-center' : 'max-w-sm rounded-card border border-border-subtle bg-elevation-2 p-5'
      )}
    >
      <div>
        <h2 className={cn('font-semibold text-heading', compact ? 'text-sm' : 'text-base')}>
          Forgot your wallet password?
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          The password cannot be reset. Recover with your 24 words, or remove this wallet locally and create another.
        </p>
      </div>

      {!confirmingRemoval ? (
        <div className="space-y-2">
          <ActionButton
            variant="filled"
            className="w-full"
            onClick={handleRecover}
            icon={<Upload className="h-4 w-4" />}
          >
            Recover with 24 words
          </ActionButton>
          <ActionButton
            type="button"
            variant="gray"
            className="w-full"
            onClick={() => setConfirmingRemoval(true)}
            icon={<RotateCcw className="h-4 w-4" />}
          >
            Remove from this device
          </ActionButton>
        </div>
      ) : (
        <div className="space-y-3 text-left">
          <div
            className={cn(
              'flex items-start rounded-card border border-destructive/20 bg-destructive/10',
              compact ? 'gap-2 p-3' : 'gap-3 p-4'
            )}
          >
            <AlertTriangle
              className={cn('mt-0.5 shrink-0 text-destructive', compact ? 'h-4 w-4' : 'h-5 w-5')}
              aria-hidden="true"
            />
            <div>
              <p className={cn('font-medium text-foreground', compact ? 'text-xs' : 'text-sm')}>
                Remove this wallet locally?
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Without the password or recovery phrase, its funds may become permanently inaccessible. An encrypted
                local recovery copy will be preserved.
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <label htmlFor="wallet-remove-confirmation" className="text-xs font-medium text-foreground">
              Type REMOVE to confirm
            </label>
            <Input
              id="wallet-remove-confirmation"
              value={confirmation}
              onChange={(event) => {
                setConfirmation(event.target.value)
                setError(null)
              }}
              placeholder="REMOVE"
              autoComplete="off"
              disabled={pending}
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={pending}
              onClick={() => setConfirmingRemoval(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="flex-1"
              disabled={confirmation !== 'REMOVE' || pending}
              onClick={() => void handleForget()}
            >
              {pending ? 'Removing…' : 'Remove wallet'}
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      )}

      {!confirmingRemoval && (
        <Button type="button" variant="ghost" size="sm" onClick={onBack} className="w-full text-muted-foreground">
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Back to unlock
        </Button>
      )}
    </div>
  )

  if (!compact) {
    return <div className="flex h-full items-center justify-center bg-background-secondary p-6">{content}</div>
  }

  return (
    <div className="flex h-full flex-col border-l border-border bg-[hsl(var(--elevation-1))]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <AppIcon name="wallet" className="h-4 w-4 text-icon" />
          <span className="text-sm font-semibold text-heading">Wallet</span>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" onClick={onClose}>
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>
      <div className="flex flex-1 items-center justify-center overflow-auto p-4">{content}</div>
    </div>
  )
}
