import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { WalletPasswordFields } from './WalletPasswordFields'
import { useWalletManagement } from '@/features/wallet/public'
import { errorMessage } from '@shared/errors'

export function WalletAddPassword() {
  const { setupPassword } = useWalletManagement()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const valid = password.length >= 10 && password === confirmation

  const handleSubmit = async () => {
    if (pendingRef.current || !valid) return
    pendingRef.current = true
    setPending(true)
    try {
      await setupPassword(password)
      setPassword('')
      setConfirmation('')
      setStatus('App password added.')
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault()
        void handleSubmit()
      }}
    >
      <WalletPasswordFields
        password={password}
        confirmation={confirmation}
        onPasswordChange={setPassword}
        onConfirmationChange={setConfirmation}
        disabled={pending}
      />
      {status && <p className="text-xs text-muted-foreground">{status}</p>}
      <Button type="submit" variant="outline" size="sm" className="w-full" disabled={!valid || pending}>
        Add app password
      </Button>
    </form>
  )
}
