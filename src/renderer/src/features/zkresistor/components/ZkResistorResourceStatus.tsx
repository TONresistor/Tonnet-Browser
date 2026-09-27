import { useTranslation } from 'react-i18next'
import { useZkResistorResources } from '../resources-store'

export function ZkResistorResourceStatus({ inline = false }: { inline?: boolean }) {
  const { t } = useTranslation('settings')
  const { state, retry } = useZkResistorResources()
  if (state.status === 'ready') return null
  const percent = state.totalBytes ? Math.min(100, Math.floor((state.receivedBytes * 100) / state.totalBytes)) : 0
  return (
    <div className={inline ? 'text-left' : 'py-3 text-center text-xs text-muted-foreground'} role="status">
      {state.status === 'error' ? (
        <>
          <p className="text-destructive">{t('advanced.experimental.zkResistorDownloadFailed')}</p>
          <button type="button" onClick={retry} className="mt-2 text-primary underline">
            {t('advanced.experimental.zkResistorRetry')}
          </button>
        </>
      ) : (
        <>
          <p>{t('advanced.experimental.zkResistorDownloading', { percent })}</p>
          <div
            role="progressbar"
            aria-label={t('advanced.experimental.zkResistor')}
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
          </div>
        </>
      )}
    </div>
  )
}
