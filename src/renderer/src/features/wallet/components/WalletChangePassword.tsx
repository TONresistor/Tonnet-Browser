import { useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useWalletManagement } from '@/features/wallet/public'
import { errorMessage } from '@shared/errors'

export function WalletChangePassword() {
  const { changePassword } = useWalletManagement()
  const [currentPassword, setCurrentPassword] = useState('')
  const [nextPassword, setNextPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)
  const pendingRef = useRef(false)

  const valid = currentPassword.length >= 10 && nextPassword.length >= 10 && nextPassword === confirmation
  return (
    <div className="space-y-2 border-t border-border pt-4">
      <p className="text-sm font-medium text-foreground">Change wallet password</p>
      <Input
        type="password"
        value={currentPassword}
        onChange={(event) => setCurrentPassword(event.target.value)}
        placeholder="Current password"
        autoComplete="current-password"
        disabled={isPending}
      />
      <Input
        type="password"
        value={nextPassword}
        onChange={(event) => setNextPassword(event.target.value)}
        placeholder="New password"
        autoComplete="new-password"
        disabled={isPending}
      />
      <Input
        type="password"
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        placeholder="Confirm new password"
        autoComplete="new-password"
        disabled={isPending}
      />
      {status && <p className="text-xs text-muted-foreground">{status}</p>}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        disabled={!valid || isPending}
        onClick={async () => {
          if (pendingRef.current) return
          pendingRef.current = true
          setIsPending(true)
          try {
            await changePassword(currentPassword, nextPassword)
            setCurrentPassword('')
            setNextPassword('')
            setConfirmation('')
            setStatus('Wallet password changed.')
          } catch (error) {
            setStatus(errorMessage(error))
          } finally {
            pendingRef.current = false
            setIsPending(false)
          }
        }}
      >
        {isPending ? 'Changing password…' : 'Change password'}
      </Button>
    </div>
  )
}
