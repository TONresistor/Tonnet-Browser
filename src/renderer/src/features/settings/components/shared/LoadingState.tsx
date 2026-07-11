/**
 * État de chargement pour les paramètres
 */

import { useTranslation } from 'react-i18next'

export function LoadingState() {
  const { t } = useTranslation('common')
  return (
    <div className="flex items-center justify-center h-full py-20">
      <div className="text-muted-foreground">{t('loading.settings')}</div>
    </div>
  )
}
