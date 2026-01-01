/**
 * Import/Export dialog for themes.
 */

import { useState } from 'react'
import { X, Upload, Download, AlertCircle, Check } from 'lucide-react'

interface ImportDialogProps {
  onImport: (json: string) => boolean
  onClose: () => void
}

export function ImportDialog({ onImport, onClose }: ImportDialogProps) {
  const [json, setJson] = useState('')
  const [error, setError] = useState('')

  const handleImport = () => {
    if (!json.trim()) {
      setError('Please paste theme JSON')
      return
    }

    const success = onImport(json)
    if (success) {
      onClose()
    } else {
      setError('Invalid theme format. Please check the JSON structure.')
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
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-[500px] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <Upload className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Import Theme</h2>
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
            <label className="block text-sm font-medium mb-2">
              Theme JSON
            </label>
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
            <span className="text-sm text-muted-foreground">Or</span>
            <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface hover:bg-surface-hover cursor-pointer transition-colors">
              <Upload className="w-4 h-4" />
              <span className="text-sm">Upload JSON file</span>
              <input
                type="file"
                accept=".json"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>

          {/* Error message */}
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
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
            Cancel
          </button>
          <button
            onClick={handleImport}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            <Check className="w-4 h-4" />
            Import
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
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(themeJson)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownload = () => {
    const blob = new Blob([themeJson], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${themeName.toLowerCase().replace(/\s+/g, '-')}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-[500px] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <Download className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Export Theme</h2>
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
            <label className="block text-sm font-medium mb-2">
              {themeName}
            </label>
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
            Close
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface hover:bg-surface-hover text-foreground transition-colors"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-success" />
                Copied
              </>
            ) : (
              'Copy'
            )}
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            <Download className="w-4 h-4" />
            Download
          </button>
        </div>
      </div>
    </div>
  )
}
