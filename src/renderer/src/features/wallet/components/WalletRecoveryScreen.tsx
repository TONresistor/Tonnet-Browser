import { LoaderCircle, Upload, AlertTriangle, ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WalletAccountCandidate } from '@shared/ipc-contract/wallet'
import { AppIcon } from '@/components/ui/AppIcon'
import { ActionButton } from '@/components/ui/ios/ActionButton'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { WalletAccountCandidates } from './WalletAccountCandidates'
import { WalletPasswordFields } from './WalletPasswordFields'

export function WalletRecoveryScreen(props: {
  recoveryInput: string
  recoveryError: string | null
  isLoading: boolean
  passwordRequired: boolean
  password: string
  confirmation: string
  candidates: WalletAccountCandidate[]
  selected: WalletAccountCandidate | null
  onRecoveryInput: (value: string) => void
  onPassword: (value: string) => void
  onConfirmation: (value: string) => void
  onSelect: (candidate: WalletAccountCandidate) => void
  onImport: () => void | Promise<void>
  onBack?: () => void
  onRemoveFromDevice?: () => void
}) {
  const { t } = useTranslation('wallet')
  const wordCount = props.recoveryInput
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean).length
  const validCount = wordCount === 24
  return (
    <div className="h-full bg-background-secondary overflow-auto" style={{ fontFamily: 'Inter, sans-serif' }}>
      <div className="p-8 max-w-4xl mx-auto">
        <div className="mb-8 flex items-center gap-3">
          <AppIcon name="wallet" className="h-6 w-6 text-icon" />
          <h1 className="text-xl font-semibold text-heading">{t('page.title')}</h1>
        </div>
        <div className="max-w-lg mx-auto space-y-6">
          <div className="flex items-start gap-3 p-4 bg-muted border border-border rounded-card">
            <AlertTriangle className="h-5 w-5 text-warning mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-heading">{t('recovery.title')}</p>
              <p className="text-xs text-muted-foreground mt-1">{t('recovery.description')}</p>
            </div>
          </div>
          <div className="space-y-3 rounded-card border border-border-subtle bg-elevation-2 p-5">
            {props.onBack && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={props.onBack}
                className="-ml-2 text-muted-foreground"
              >
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Back to unlock
              </Button>
            )}
            <textarea
              className={cn(
                'w-full h-24 p-3 text-sm rounded-lg border bg-background text-foreground resize-none',
                'focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground'
              )}
              placeholder={t('import.placeholder')}
              value={props.recoveryInput}
              onChange={(event) => props.onRecoveryInput(event.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
            <div className="flex items-center justify-between">
              <span className={cn('text-xs', validCount ? 'text-success' : 'text-muted-foreground')}>
                {wordCount} words
              </span>
              {props.recoveryError && <span className="text-xs text-destructive">{props.recoveryError}</span>}
            </div>
            {props.passwordRequired && (
              <WalletPasswordFields
                password={props.password}
                confirmation={props.confirmation}
                onPasswordChange={props.onPassword}
                onConfirmationChange={props.onConfirmation}
                disabled={props.isLoading}
              />
            )}
            <WalletAccountCandidates
              candidates={props.candidates}
              selected={props.selected}
              onSelect={props.onSelect}
            />
            <ActionButton
              variant="filled"
              onClick={props.onImport}
              disabled={props.isLoading || !validCount}
              className="w-full"
              icon={
                props.isLoading ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Upload className="h-4 w-4" aria-hidden="true" />
                )
              }
            >
              {props.isLoading
                ? t('import.importing')
                : props.candidates.length === 0
                  ? 'Find wallet accounts'
                  : 'Import selected account'}
            </ActionButton>
            {props.onRemoveFromDevice && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={props.onRemoveFromDevice}
                className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                Remove this wallet from this device
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
