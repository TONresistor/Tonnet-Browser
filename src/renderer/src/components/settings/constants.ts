/**
 * Constantes pour les composants Settings
 */

import {
  Globe,
  Wifi,
  HardDrive,
  Palette,
  Trash2,
  Shield,
  History as HistoryIcon,
  Keyboard,
  Bookmark,
  Wrench,
  Info,
} from 'lucide-react'
import type { SectionInfo, Shortcut } from './types'

/**
 * Liste des sections disponibles avec leurs métadonnées
 */
export const SECTIONS: SectionInfo[] = [
  { id: 'general', label: 'General', icon: Globe },
  { id: 'network', label: 'Network', icon: Wifi },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'privacy', label: 'Privacy', icon: Trash2 },
  { id: 'content-filtering', label: 'Content Filtering', icon: Shield },
  { id: 'history', label: 'History', icon: HistoryIcon },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'bookmarks', label: 'Bookmarks', icon: Bookmark },
  { id: 'advanced', label: 'Advanced', icon: Wrench },
  { id: 'about', label: 'About', icon: Info },
]

/**
 * Liste des raccourcis clavier disponibles
 */
export const SHORTCUTS: Shortcut[] = [
  { action: 'New tab', shortcut: 'Ctrl+T' },
  { action: 'Close tab', shortcut: 'Ctrl+W' },
  { action: 'Reopen closed tab', shortcut: 'Ctrl+Shift+T' },
  { action: 'Next tab', shortcut: 'Ctrl+Tab' },
  { action: 'Previous tab', shortcut: 'Ctrl+Shift+Tab' },
  { action: 'Go to tab 1-9', shortcut: 'Ctrl+1-9' },
  { action: 'History', shortcut: 'Ctrl+H' },
  { action: 'Focus address bar', shortcut: 'Ctrl+L' },
  { action: 'Reload', shortcut: 'Ctrl+R / F5' },
  { action: 'Back', shortcut: 'Alt+←' },
  { action: 'Forward', shortcut: 'Alt+→' },
  { action: 'Stop loading', shortcut: 'Escape' },
  { action: 'Zoom in', shortcut: 'Ctrl++' },
  { action: 'Zoom out', shortcut: 'Ctrl+-' },
  { action: 'Reset zoom', shortcut: 'Ctrl+0' },
  { action: 'Developer tools', shortcut: 'F12' },
]
