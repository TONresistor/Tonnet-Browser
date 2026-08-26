import encryptedIcon from '@/assets/telegram-lockedstickers.svg'
import { cn } from '@/lib/utils'

interface EncryptedIconProps {
  className?: string
}

export function EncryptedIcon({ className }: EncryptedIconProps): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      data-wallet-icon="encrypted"
      className={cn('inline-block shrink-0', className)}
      style={{
        backgroundColor: 'currentColor',
        maskImage: `url("${encryptedIcon}")`,
        WebkitMaskImage: `url("${encryptedIcon}")`,
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
