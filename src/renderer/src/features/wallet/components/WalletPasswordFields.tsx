import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Eye, EyeOff } from 'lucide-react'
import { useState, type Ref } from 'react'

interface WalletPasswordFieldsProps {
  password: string
  confirmation?: string
  onPasswordChange: (value: string) => void
  onConfirmationChange?: (value: string) => void
  disabled?: boolean
  autoFocus?: boolean
  passwordInputRef?: Ref<HTMLInputElement>
}

export function WalletPasswordFields({
  password,
  confirmation,
  onPasswordChange,
  onConfirmationChange,
  disabled,
  autoFocus,
  passwordInputRef,
}: WalletPasswordFieldsProps) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="w-full space-y-2">
      <div className="relative">
        <Input
          ref={passwordInputRef}
          type={visible ? 'text' : 'password'}
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
          placeholder="Wallet password"
          autoComplete="new-password"
          autoFocus={autoFocus}
          disabled={disabled}
          className="pr-10"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setVisible((current) => !current)}
          disabled={disabled}
          aria-label={visible ? 'Hide wallet password' : 'Show wallet password'}
          className="absolute right-0 top-0 h-9 w-9 text-muted-foreground hover:text-foreground"
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </Button>
      </div>
      {onConfirmationChange && (
        <div className="relative">
          <Input
            type={visible ? 'text' : 'password'}
            value={confirmation ?? ''}
            onChange={(event) => onConfirmationChange(event.target.value)}
            placeholder="Confirm wallet password"
            autoComplete="new-password"
            disabled={disabled}
            className="pr-10"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setVisible((current) => !current)}
            disabled={disabled}
            aria-label={visible ? 'Hide wallet password confirmation' : 'Show wallet password confirmation'}
            className="absolute right-0 top-0 h-9 w-9 text-muted-foreground hover:text-foreground"
          >
            {visible ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
