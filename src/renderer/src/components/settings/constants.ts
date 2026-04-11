/**
 * Constantes pour les composants Settings
 */

import { Globe, HardDrive, History as HistoryIcon, Wrench, Info, Cable } from 'lucide-react'
import type { SectionInfo, Shortcut } from './types'
import walletIconSrc from '@/assets/wallet.svg'
import privacyIconSrc from '@/assets/privacy.svg'
import networkIconSrc from '@/assets/network.svg'
import appearanceIconSrc from '@/assets/appearance.svg'
import bookmarkIconSrc from '@/assets/bookmark.svg'

// SVG icon component using asset (no JSX in .ts, use createElement)
import { createElement } from 'react'
function SvgIcon(src: string) {
  return function Icon({ className }: { className?: string }) {
    const isInactive = className?.includes('opacity')
    return createElement('img', {
      src,
      alt: '',
      className: className?.replace('opacity-70', '') || '',
      style: { filter: `brightness(0) invert(${isInactive ? '0.45' : '0.85'})` },
    })
  }
}
const WalletIcon = SvgIcon(walletIconSrc)
const PrivacyIcon = SvgIcon(privacyIconSrc)
const NetworkIcon = SvgIcon(networkIconSrc)
const AppearanceIcon = SvgIcon(appearanceIconSrc)
const BookmarkIcon = SvgIcon(bookmarkIconSrc)

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
  { id: 'general', label: 'General', icon: Globe },
  { id: 'privacy', label: 'Privacy', icon: PrivacyIcon },
  { id: 'appearance', label: 'Appearance', icon: AppearanceIcon },
  { id: 'wallet', label: 'Wallet', icon: WalletIcon },
  { id: 'bridge', label: 'Bridge', icon: Cable },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'bookmarks', label: 'Bookmarks', icon: BookmarkIcon },
  { id: 'network', label: 'Network', icon: NetworkIcon },
  { id: 'advanced', label: 'Advanced', icon: Wrench },
  { id: 'about', label: 'About', icon: Info },
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
