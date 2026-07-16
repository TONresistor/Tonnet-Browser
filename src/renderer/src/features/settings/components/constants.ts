/**
 * Constantes pour les composants Settings
 */

import { AtSign, Globe, HardDrive, Wrench, Info, Cable } from 'lucide-react'
import type { SectionInfo, Shortcut } from './types'
import { AppIcon, type AppIconName } from '@/components/ui/AppIcon'

// SVG icon component using asset (no JSX in .ts, use createElement)
import { createElement } from 'react'
function ThemedIcon(name: AppIconName) {
  return function Icon({ className }: { className?: string }) {
    return createElement(AppIcon, { name, className })
  }
}
const WalletIcon = ThemedIcon('wallet')
const CocoonIcon = ThemedIcon('cocoon')
const PrivacyIcon = ThemedIcon('privacy')
const NetworkIcon = ThemedIcon('network')
const AppearanceIcon = ThemedIcon('appearance')

const isMac =
  ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform)
    .toUpperCase()
    .indexOf('MAC') >= 0

const mod = (key: string): string => {
  if (!isMac) return key
  return key.replace('Ctrl', '⌘').replace('Alt', '⌥').replace('Shift', '⇧')
}

/**
 * Liste des sections disponibles avec leurs métadonnées
 */
export const SECTIONS: SectionInfo[] = [
  // Group 0 — Preferences
  { id: 'general', label: 'General', icon: Globe, tileClass: 'bg-muted text-icon', group: 0 },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: AppearanceIcon,
    tileClass: 'bg-destructive text-icon',
    group: 0,
  },
  { id: 'privacy', label: 'Privacy', icon: PrivacyIcon, tileClass: 'bg-success text-icon', group: 0 },
  { id: 'network', label: 'Network', icon: NetworkIcon, tileClass: 'bg-info text-icon', group: 0 },
  {
    id: 'nameServices',
    label: 'Name Services',
    icon: AtSign,
    tileClass: 'bg-accent text-icon',
    group: 0,
  },
  { id: 'storage', label: 'Storage', icon: HardDrive, tileClass: 'bg-secondary text-icon', group: 0 },
  { id: 'wallet', label: 'Wallet', icon: WalletIcon, tileClass: 'bg-primary text-icon', group: 1 },
  { id: 'bridge', label: 'Bridge', icon: Cable, tileClass: 'bg-warning text-icon', group: 1 },
  { id: 'cocoon', label: 'Cocoon AI', icon: CocoonIcon, tileClass: 'bg-accent text-icon', group: 1 },
  { id: 'advanced', label: 'Advanced', icon: Wrench, tileClass: 'bg-muted text-icon', group: 2 },
  // Group 3 — Info
  { id: 'about', label: 'About', icon: Info, tileClass: 'bg-info text-icon', group: 3 },
]

/**
 * Liste des raccourcis clavier disponibles
 */
export const SHORTCUTS: Shortcut[] = [
  { action: 'New tab', shortcut: mod('Ctrl+T') },
  { action: 'Close tab', shortcut: mod('Ctrl+W') },
  { action: 'Reopen closed tab', shortcut: mod('Ctrl+Shift+T') },
  { action: 'Next tab', shortcut: 'Ctrl+Tab' },
  { action: 'Previous tab', shortcut: 'Ctrl+Shift+Tab' },
  { action: 'Go to tab 1-9', shortcut: mod('Ctrl+1-9') },
  { action: 'History', shortcut: mod('Ctrl+H') },
  { action: 'Focus address bar', shortcut: mod('Ctrl+L') },
  { action: 'Reload', shortcut: `${mod('Ctrl+R')} / F5` },
  { action: 'Back', shortcut: isMac ? '⌘+←' : 'Alt+←' },
  { action: 'Forward', shortcut: isMac ? '⌘+→' : 'Alt+→' },
  { action: 'Stop loading', shortcut: 'Escape' },
  { action: 'Zoom in', shortcut: mod('Ctrl++') },
  { action: 'Zoom out', shortcut: mod('Ctrl+-') },
  { action: 'Reset zoom', shortcut: mod('Ctrl+0') },
  { action: 'Developer tools', shortcut: isMac ? '⌘+⌥+I / F12' : 'Ctrl+Shift+I / F12' },
]
