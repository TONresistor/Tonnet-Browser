import sendIcon from '@/assets/telegram-send.svg'
import { cn } from '@/lib/utils'

interface SendActionIconProps {
  className?: string
}

export function SendActionIcon({ className }: SendActionIconProps): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block shrink-0', className)}
      style={{
        backgroundColor: 'currentColor',
        maskImage: `url("${sendIcon}")`,
        WebkitMaskImage: `url("${sendIcon}")`,
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
