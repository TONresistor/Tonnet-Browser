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
  | 'history'
  | 'shortcuts'
  | 'bookmarks'
  | 'advanced'
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
}

/**
 * Définition d'un raccourci clavier
 */
export interface Shortcut {
  action: string
  shortcut: string
}
