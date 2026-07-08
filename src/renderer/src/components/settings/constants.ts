/**
 * Constantes pour les composants Settings
 */

import { AtSign, Globe, HardDrive, Wrench, Info, Cable } from 'lucide-react'
import type { SectionInfo, Shortcut } from './types'
import walletIconSrc from '@/assets/wallet.svg'
import cocoonIconSrc from '@/assets/cocoon.png'
import privacyIconSrc from '@/assets/privacy.svg'
import networkIconSrc from '@/assets/network.svg'
import appearanceIconSrc from '@/assets/appearance.svg'

// SVG icon component using asset (no JSX in .ts, use createElement)
import { createElement } from 'react'
function SvgIcon(src: string) {
  return function Icon({ className }: { className?: string }) {
    // Rendered as a white glyph so it sits on the colored iOS-style tile in the settings list.
    return createElement('img', {
      src,
      alt: '',
      className: className ?? '',
      style: { filter: 'brightness(0) invert(1)' },
    })
  }
}
const WalletIcon = SvgIcon(walletIconSrc)
const CocoonIcon = SvgIcon(cocoonIconSrc)
const PrivacyIcon = SvgIcon(privacyIconSrc)
const NetworkIcon = SvgIcon(networkIconSrc)
const AppearanceIcon = SvgIcon(appearanceIconSrc)

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
  { id: 'general', label: 'General', icon: Globe, color: '#8E8E93', group: 0 },
  { id: 'appearance', label: 'Appearance', icon: AppearanceIcon, color: '#FF2D55', group: 0 },
  { id: 'privacy', label: 'Privacy', icon: PrivacyIcon, color: '#34C759', group: 0 },
  { id: 'network', label: 'Network', icon: NetworkIcon, color: '#5AC8FA', group: 0 },
  { id: 'nameServices', label: 'Name Services', icon: AtSign, color: '#AF52DE', group: 0 },
  { id: 'storage', label: 'Storage', icon: HardDrive, color: '#5856D6', group: 0 },
  { id: 'wallet', label: 'Wallet', icon: WalletIcon, color: '#0098EA', group: 1 },
  { id: 'bridge', label: 'Bridge', icon: Cable, color: '#FF9500', group: 1 },
  { id: 'cocoon', label: 'Cocoon AI', icon: CocoonIcon, color: '#7B61FF', group: 1 },
  { id: 'advanced', label: 'Advanced', icon: Wrench, color: '#636366', group: 2 },
  // Group 3 — Info
  { id: 'about', label: 'About', icon: Info, color: '#0A84FF', group: 3 },
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
