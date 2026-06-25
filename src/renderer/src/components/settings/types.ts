/**
 * Types partagés pour les composants Settings
 */

import type { AppPreferences } from '@/stores/preferences'

/**
 * Sections disponibles dans les paramètres
 */
export type SettingsSection =
  | 'general'
  | 'network'
  | 'storage'
  | 'appearance'
  | 'privacy'
  | 'bookmarks'
  | 'advanced'
  | 'wallet'
  | 'bridge'
  | 'cocoon'
  | 'about'

/**
 * Props communes à toutes les sections
 */
export interface SectionProps {
  draft: AppPreferences
  setDraft: <K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => void
}

/**
 * Information sur une section (pour la navigation)
 */
export interface SectionInfo {
  id: SettingsSection
  label: string
  icon: React.ElementType
  /** iOS-style tile color (hex) for the settings list icon */
  color: string
  /** Index of the grouped inset block this section belongs to */
  group: number
}

/**
 * Définition d'un raccourci clavier
 */
export interface Shortcut {
  action: string
  shortcut: string
}
