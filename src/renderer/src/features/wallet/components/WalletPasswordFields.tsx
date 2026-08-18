import { Input } from '@/components/ui/input'

interface WalletPasswordFieldsProps {
  password: string
  confirmation?: string
  onPasswordChange: (value: string) => void
  onConfirmationChange?: (value: string) => void
  disabled?: boolean
}

export function WalletPasswordFields({
  password,
  confirmation,
  onPasswordChange,
  onConfirmationChange,
  disabled,
}: WalletPasswordFieldsProps) {
  return (
    <div className="w-full space-y-2">
      <Input
        type="password"
        value={password}
        onChange={(event) => onPasswordChange(event.target.value)}
        placeholder="Wallet password"
        autoComplete="new-password"
        disabled={disabled}
      />
      {onConfirmationChange && (
        <Input
          type="password"
          value={confirmation ?? ''}
          onChange={(event) => onConfirmationChange(event.target.value)}
          placeholder="Confirm wallet password"
          autoComplete="new-password"
          disabled={disabled}
        />
      )}
    </div>
  )
}
