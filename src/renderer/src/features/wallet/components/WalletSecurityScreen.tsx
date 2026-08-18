import { ActionButton } from '@/components/ui/ios/ActionButton'
import { WalletPasswordFields } from './WalletPasswordFields'

type SecurityMode = 'setup' | 'unlock' | 'backup'

interface WalletSecurityScreenProps {
  mode: SecurityMode
  password: string
  confirmation?: string
  error?: string | null
  onPasswordChange: (value: string) => void
  onConfirmationChange?: (value: string) => void
  onSubmit: () => void | Promise<void>
}

const COPY: Record<SecurityMode, { title: string; description: string; action: string; warning?: boolean }> = {
  setup: {
    title: 'Protect your existing wallet',
    description: 'Set an application password before this wallet can sign transactions.',
    action: 'Protect wallet',
  },
  unlock: {
    title: 'Unlock wallet',
    description: 'The private key remains encrypted until you unlock it.',
    action: 'Unlock',
  },
  backup: {
    title: 'Verify wallet backup',
    description: 'Re-enter your wallet password to resume the recovery-word check.',
    action: 'Continue verification',
    warning: true,
  },
}

export function WalletSecurityScreen({
  mode,
  password,
  confirmation,
  error,
  onPasswordChange,
  onConfirmationChange,
  onSubmit,
}: WalletSecurityScreenProps) {
  const copy = COPY[mode]
  return (
    <div className="flex h-full items-center justify-center bg-background-secondary p-6">
      <div
        className={`w-full max-w-sm space-y-4 rounded-card border bg-elevation-2 p-5 ${
          copy.warning ? 'border-warning/20' : 'border-border-subtle'
        }`}
      >
        <div>
          <h2 className="font-semibold text-heading">{copy.title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{copy.description}</p>
        </div>
        <WalletPasswordFields
          password={password}
          confirmation={confirmation}
          onPasswordChange={onPasswordChange}
          onConfirmationChange={onConfirmationChange}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <ActionButton variant="filled" className="w-full" onClick={onSubmit}>
          {copy.action}
        </ActionButton>
      </div>
    </div>
  )
}
