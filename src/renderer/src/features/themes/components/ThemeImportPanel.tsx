import { useRef, useState } from 'react'
import { ArrowLeft, FileJson, Upload } from 'lucide-react'
import type { CustomTheme } from '@shared/types'
import { importThemeFromJson } from '@/lib/theme-utils'
import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'

interface ThemeImportPanelProps {
  json: string
  onJsonChange: (json: string) => void
  onReview: (theme: CustomTheme) => void
  onBack: () => void
}

export function ThemeImportPanel({ json, onJsonChange, onReview, onBack }: ThemeImportPanelProps) {
  const { t } = useTranslation('settings')
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const review = () => {
    const theme = importThemeFromJson(json)
    if (!theme) {
      setError(t('themeEditor.importDialog.invalidFormat'))
      return
    }
    onReview(theme)
  }

  return (
    <section className="mx-auto w-full max-w-[880px]">
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="-ml-3 mb-6 gap-2 text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('themePage.backToLibrary')}
      </Button>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
          <FileJson className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-heading">{t('themeEditor.importDialog.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('themePage.importDescription')}</p>
        </div>
      </div>

      <div className="mt-6 rounded-card border border-border-subtle bg-elevation-1 p-3">
        <textarea
          value={json}
          onChange={(event) => {
            onJsonChange(event.target.value)
            setError('')
          }}
          placeholder={t('themeEditor.importDialog.themeJson')}
          aria-label={t('themeEditor.importDialog.themeJson')}
          className="h-72 w-full resize-none rounded-field border border-border-medium bg-elevation-2 p-4 font-mono text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-control bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-2">
          <Upload className="h-4 w-4" />
          {t('themeEditor.importDialog.uploadFile')}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (!file) return
            const reader = new FileReader()
            reader.onload = () => {
              if (typeof reader.result === 'string') {
                onJsonChange(reader.result)
                setError('')
              }
            }
            reader.onerror = () => setError(t('themeEditor.importDialog.invalidFormat'))
            reader.readAsText(file)
            event.currentTarget.value = ''
          }}
        />
        <Button onClick={review} disabled={!json.trim()}>
          {t('themePage.reviewImport')}
        </Button>
      </div>
    </section>
  )
}
