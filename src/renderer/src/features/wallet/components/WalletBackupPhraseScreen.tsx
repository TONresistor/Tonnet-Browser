import { AlertTriangle, Check, Copy, Eye, EyeOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ActionButton } from '@/components/ui/ios/ActionButton'
import { AppIcon } from '@/components/ui/AppIcon'
import { useState } from 'react'

export function WalletBackupPhraseScreen({
  words,
  revealed,
  copied,
  pending,
  error,
  onReveal,
  onCopy,
  onContinue,
}: {
  words: string[]
  revealed: boolean
  copied: boolean
  pending: boolean
  error?: string | null
  onReveal: () => void
  onCopy: () => void
  onContinue: () => void | Promise<void>
}) {
  const { t } = useTranslation('wallet')
  const [acknowledged, setAcknowledged] = useState(false)
  return (
    <div className="h-full overflow-auto bg-background-secondary" style={{ fontFamily: 'Inter, sans-serif' }}>
      <div className="mx-auto max-w-4xl p-8">
        <div className="mb-8 flex items-center gap-3">
          <AppIcon name="wallet" className="h-6 w-6 text-icon" />
          <h1 className="text-xl font-semibold text-heading">{t('backup.title')}</h1>
        </div>

        <div className="mx-auto max-w-lg space-y-6">
          <div className="flex items-start gap-3 rounded-card border border-warning/20 bg-warning/10 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-foreground">{t('backup.warning')}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t('backup.warningDesc')}</p>
            </div>
          </div>

          <div className="rounded-card border border-border-subtle bg-elevation-2 p-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-medium text-foreground">{t('backup.yourPhrase')}</p>
              <Button type="button" variant="ghost" size="sm" onClick={onReveal}>
                {revealed ? (
                  <EyeOff className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                )}
                {revealed ? t('export.hideButton') : t('export.showButton')}
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {words.map((word, index) => (
                <div key={index} className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
                  <span className="w-6 text-right font-mono text-xs text-muted-foreground">{index + 1}.</span>
                  <span className="font-mono text-foreground">{revealed ? word : '•••••'}</span>
                </div>
              ))}
            </div>

            <ActionButton
              variant="gray"
              onClick={onCopy}
              className="mt-4 w-full"
              icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            >
              {copied ? t('export.copied') : t('backup.copy')}
            </ActionButton>
          </div>

          <label className="flex cursor-pointer select-none items-start gap-2 rounded-card border border-border-subtle bg-elevation-2 p-4">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={!revealed || pending}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary"
            />
            <span className="text-xs leading-relaxed text-muted-foreground">{t('backup.acknowledgement')}</span>
          </label>

          {error && <p className="text-xs text-destructive">{error}</p>}
          <ActionButton
            variant="filled"
            className="w-full"
            disabled={!revealed || !acknowledged || pending}
            onClick={onContinue}
          >
            {pending
              ? t('backup.preparing', { defaultValue: 'Preparing verification…' })
              : t('backup.continueVerification', { defaultValue: 'I saved it — continue' })}
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
