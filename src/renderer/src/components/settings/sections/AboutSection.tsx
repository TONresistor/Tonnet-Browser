/**
 * Section À propos
 */

import { memo } from 'react'
import { ExternalLink } from 'lucide-react'
import { SectionHeader } from '../shared/SectionHeader'
import { APP_NAME, APP_VERSION } from '@shared/constants'
import tonLogo from '@/assets/ton.png'
import { useTranslation } from 'react-i18next'

export const AboutSection = memo(function AboutSection() {
  const { t } = useTranslation('settings')

  return (
    <div>
      <SectionHeader title={t('about.title')} />
      <div className="bg-card rounded-xl border border-border p-6 text-center">
        <div className="w-16 h-16 mx-auto mb-4">
          <img src={tonLogo} alt="TON" className="w-full h-full object-contain" />
        </div>
        <h3 className="text-2xl font-bold text-foreground mb-1">{APP_NAME}</h3>
        <p className="text-muted-foreground mb-4">Version {APP_VERSION}</p>
        <p className="text-muted-foreground text-sm max-w-md mx-auto">
          {t('about.description')}
        </p>

        <div className="mt-6 pt-6 border-t border-border">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">{t('about.electron')}</p>
              <p className="text-foreground font-mono">
                {window.electron?.versions?.electron || 'N/A'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">{t('about.chromium')}</p>
              <p className="text-foreground font-mono">
                {window.electron?.versions?.chrome || 'N/A'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">{t('about.nodejs')}</p>
              <p className="text-foreground font-mono">
                {window.electron?.versions?.node || 'N/A'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex gap-3">
        <button
          className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium text-muted-foreground transition-all duration-200 hover:text-foreground bg-surface-hover border border-border-medium"
          onClick={() => window.electron.navigate('http://github.com/example/ton-browser')}
        >
          <ExternalLink className="h-4 w-4" />
          {t('about.github')}
        </button>
      </div>
    </div>
  )
})
