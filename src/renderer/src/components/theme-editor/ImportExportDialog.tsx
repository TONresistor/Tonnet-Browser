/**
 * Import/Export dialog for themes.
 */

import { useState } from 'react'
import { UI_COPY_FEEDBACK_MS } from '@shared/constants'
import { downloadTextFile } from '@/lib/download'
import { X, Upload, Download, CircleAlert, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface ImportDialogProps {
  onImport: (json: string) => boolean
  onClose: () => void
}

export function ImportDialog({ onImport, onClose }: ImportDialogProps) {
  const { t } = useTranslation('settings')
  const [json, setJson] = useState('')
  const [error, setError] = useState('')

  const handleImport = () => {
    if (!json.trim()) {
      setError(t('themeEditor.importDialog.pastePrompt'))
      return
    }

    const success = onImport(json)
    if (success) {
      onClose()
    } else {
      setError(t('themeEditor.importDialog.invalidFormat'))
    }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result
      if (typeof content === 'string') {
        setJson(content)
        setError('')
      }
    }
    reader.readAsText(file)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-[500px] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <Upload className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">{t('themeEditor.importDialog.title')}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-hover text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">{t('themeEditor.importDialog.themeJson')}</label>
            <textarea
              value={json}
              onChange={(e) => {
                setJson(e.target.value)
                setError('')
              }}
              placeholder={`{
  "version": 1,
  "name": "My Theme",
  "isDark": true,
  "colors": {
    "background": "220 20% 10%",
    "primary": "200 80% 50%",
    ...
  }
}`}
              className="w-full h-48 px-3 py-2 rounded-lg bg-background border border-border font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* File upload */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{t('themeEditor.importDialog.or')}</span>
            <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface hover:bg-surface-hover cursor-pointer transition-colors">
              <Upload className="w-4 h-4" />
              <span className="text-sm">{t('themeEditor.importDialog.uploadFile')}</span>
              <input type="file" accept=".json" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>

          {/* Error message */}
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              <CircleAlert className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-background-secondary">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-surface hover:bg-surface-hover text-foreground transition-colors"
          >
            {t('themeEditor.editor.cancel')}
          </button>
          <button
            onClick={handleImport}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            <Check className="w-4 h-4" />
            {t('themeEditor.importDialog.import')}
          </button>
        </div>
      </div>
    </div>
  )
}

interface ExportDialogProps {
  themeJson: string
  themeName: string
  onClose: () => void
}

export function ExportDialog({ themeJson, themeName, onClose }: ExportDialogProps) {
  const { t } = useTranslation('settings')
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(themeJson)
    setCopied(true)
    setTimeout(() => setCopied(false), UI_COPY_FEEDBACK_MS)
  }

  const handleDownload = () => {
    downloadTextFile(themeJson, `${themeName.toLowerCase().replace(/\s+/g, '-')}.json`)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-[500px] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <Download className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">{t('themeEditor.exportDialog.title')}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-hover text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">{themeName}</label>
            <pre className="w-full h-48 px-3 py-2 rounded-lg bg-background border border-border font-mono text-xs overflow-auto">
              {themeJson}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-background-secondary">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-surface hover:bg-surface-hover text-foreground transition-colors"
          >
            {t('themeEditor.exportDialog.close')}
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface hover:bg-surface-hover text-foreground transition-colors"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-success" />
                {t('themeEditor.exportDialog.copied')}
              </>
            ) : (
              t('themeEditor.exportDialog.copy')
            )}
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            <Download className="w-4 h-4" />
            {t('themeEditor.exportDialog.download')}
          </button>
        </div>
      </div>
    </div>
  )
}
