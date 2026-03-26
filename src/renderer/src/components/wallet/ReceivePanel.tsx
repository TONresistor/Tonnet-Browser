/**
 * Receive panel: shows wallet address with a real scannable QR code.
 */

import { useState, useEffect, useRef, memo } from 'react'
import { Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import { UI_COPY_FEEDBACK_MS } from '@shared/constants'
import { createLogger } from '@/logger'

const log = createLogger('wallet:receive')

interface ReceivePanelProps {
  address: string
}

function AddressQR({ address }: { address: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!canvasRef.current || !address) return
    QRCode.toCanvas(canvasRef.current, address, {
      width: 200,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    }).catch((err) => {
      log.warn('QR code generation failed:', err)
    })
  }, [address])

  return <canvas ref={canvasRef} className="rounded-lg" width={200} height={200} />
}

export const ReceivePanel = memo(function ReceivePanel({ address }: ReceivePanelProps) {
  const { t } = useTranslation('wallet')
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), UI_COPY_FEEDBACK_MS)
    } catch {
      // clipboard unavailable
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <AddressQR address={address} />

      <div className="w-full max-w-sm">
        <p className="text-xs text-muted-foreground text-center mb-2">{t('receive.addressLabel')}</p>
        <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2">
          <span className="flex-1 text-xs font-mono text-foreground break-all select-all">{address}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={handleCopy}
            title={t('receive.copyTitle')}
            aria-label={t('receive.copyAria')}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </Button>
        </div>
        {copied && <p className="text-xs text-success text-center mt-1">{t('receive.copied')}</p>}
      </div>
    </div>
  )
})
