import type { ComponentType } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, Settings, X } from 'lucide-react'
import homeIcon from '@/assets/home.svg'
import walletIcon from '@/assets/wallet.svg'
import storageIcon from '@/assets/storage.svg'
import storageFilterAllIcon from '@/assets/storage-filter-all.svg'
import storageFilterDownloadIcon from '@/assets/storage-filter-download.svg'
import storageFilterCompleteIcon from '@/assets/storage-filter-complete.svg'
import messengerIcon from '@/assets/messenger.svg'
import cocoonIcon from '@/assets/cocoon.png'
import appearanceIcon from '@/assets/appearance.svg'
import privacyIcon from '@/assets/privacy.svg'
import networkIcon from '@/assets/network.svg'
import historyIcon from '@/assets/history.svg'
import dnsIcon from '@/assets/dns.svg'
import bookmarkIcon from '@/assets/bookmark.svg'
import keyboardIcon from '@/assets/keyboard.svg'
import messengerDeviceIcon from '@/assets/messenger-device.svg'
import messengerResetIcon from '@/assets/messenger-reset.svg'
import anonAvatarIcon from '@/assets/anon-avatar.svg'
import tonIcon from '@/assets/ton.svg'
import { cn } from '@/lib/utils'

const VECTOR_ICONS = {
  back: ArrowLeft,
  forward: ArrowRight,
  reload: RotateCw,
  stop: X,
  settings: Settings,
} as const satisfies Record<string, ComponentType<{ className?: string; 'aria-hidden'?: boolean }>>

const MASK_ICONS = {
  home: homeIcon,
  wallet: walletIcon,
  storage: storageIcon,
  storageFilterAll: storageFilterAllIcon,
  storageFilterDownload: storageFilterDownloadIcon,
  storageFilterComplete: storageFilterCompleteIcon,
  messenger: messengerIcon,
  cocoon: cocoonIcon,
  appearance: appearanceIcon,
  privacy: privacyIcon,
  network: networkIcon,
  history: historyIcon,
  dns: dnsIcon,
  bookmark: bookmarkIcon,
  keyboard: keyboardIcon,
  messengerDevice: messengerDeviceIcon,
  messengerReset: messengerResetIcon,
  anonAvatar: anonAvatarIcon,
  ton: tonIcon,
} as const

export type AppIconName = keyof typeof VECTOR_ICONS | keyof typeof MASK_ICONS

interface AppIconProps {
  name: AppIconName
  className?: string
}

export function AppIcon({ name, className }: AppIconProps): React.JSX.Element {
  if (name in VECTOR_ICONS) {
    const Icon = VECTOR_ICONS[name as keyof typeof VECTOR_ICONS]
    return <Icon className={className} aria-hidden />
  }

  const source = MASK_ICONS[name as keyof typeof MASK_ICONS]
  return (
    <span
      aria-hidden="true"
      data-app-icon={name}
      className={cn('inline-block shrink-0', className)}
      style={{
        backgroundColor: 'currentColor',
        maskImage: `url("${source}")`,
        WebkitMaskImage: `url("${source}")`,
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
      }}
    />
  )
}
