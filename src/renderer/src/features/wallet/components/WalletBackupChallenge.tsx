import { Input } from '@/components/ui/input'
import { ActionButton } from '@/components/ui/ios/ActionButton'
import { AppIcon } from '@/components/ui/AppIcon'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function WalletBackupChallenge({
  indexes,
  answers,
  error,
  pending,
  onChange,
  onSubmit,
  onBack,
}: {
  indexes: number[]
  answers: Record<number, string>
  error?: string | null
  pending: boolean
  onChange: (index: number, value: string) => void
  onSubmit: () => void | Promise<void>
  onBack: () => void
}) {
  const { t } = useTranslation('wallet')
  return (
    <div className="flex h-full items-center justify-center bg-background-secondary p-6">
      <div className="w-full max-w-sm space-y-4 rounded-card border border-border-subtle bg-elevation-2 p-5">
        <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={onBack} disabled={pending}>
          <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {t('send.back')}
        </Button>
        <div className="flex items-center gap-3">
          <AppIcon name="wallet" className="h-5 w-5 text-icon" />
          <div>
            <h2 className="font-semibold text-heading">
              {t('backup.verifyTitle', { defaultValue: 'Confirm your backup' })}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('backup.verifyDescription', {
                defaultValue: 'Use the recovery phrase you saved. It is no longer displayed on this page.',
              })}
            </p>
          </div>
        </div>
        <div className="space-y-2">
          {indexes.map((index) => (
            <Input
              key={index}
              value={answers[index] ?? ''}
              onChange={(event) => onChange(index, event.target.value.trim().toLowerCase())}
              placeholder={t('backup.wordNumber', { defaultValue: `Word #${index + 1}`, number: index + 1 })}
              autoComplete="off"
              spellCheck={false}
            />
          ))}
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <ActionButton
          variant="filled"
          className="w-full"
          disabled={pending || indexes.length === 0 || indexes.some((index) => !answers[index])}
          onClick={onSubmit}
        >
          {pending
            ? t('backup.verifying', { defaultValue: 'Verifying…' })
            : t('backup.verifyButton', { defaultValue: 'Verify backup' })}
        </ActionButton>
      </div>
    </div>
  )
}
