/**
 * Boutons d'actions Save/Discard pour les paramètres
 */

import { Save, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface SettingsActionsProps {
  hasChanges: boolean
  isSaving: boolean
  onSave: () => Promise<void>
  onDiscard: () => void
}

export function SettingsActions({ hasChanges, isSaving, onSave, onDiscard }: SettingsActionsProps) {
  const { t } = useTranslation('settings')

  if (!hasChanges) return null

  return (
    <div className="px-6 py-3 flex items-center justify-between bg-surface/50 backdrop-blur-lg border-t border-border">
      <p className="text-muted-foreground text-sm">{t('actions.unsavedChanges')}</p>
      <div className="flex gap-3">
        <button
          onClick={onDiscard}
          disabled={isSaving}
          className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium text-muted-foreground transition-all duration-200 hover:text-foreground disabled:opacity-50 bg-surface-hover backdrop-blur-md border border-border-medium"
        >
          <X className="h-4 w-4" />
          {t('actions.discard')}
        </button>
        <button
          onClick={onSave}
          disabled={isSaving}
          className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 hover:scale-[1.02] disabled:opacity-50 bg-primary/90 backdrop-blur-md shadow-[0_4px_16px_var(--primary-glow),inset_0_1px_0_var(--button-highlight)] text-identity-foreground"
        >
          <Save className="h-4 w-4" />
          {isSaving ? t('actions.saving') : t('actions.saveChanges')}
        </button>
      </div>
    </div>
  )
}
