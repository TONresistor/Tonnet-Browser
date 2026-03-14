/**
 * Section Privacy
 */

import { memo } from 'react'
import { Trash2, CheckCircle } from 'lucide-react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { Toggle } from '../shared/Toggle'
import type { SectionProps } from '../types'
import { useTranslation } from 'react-i18next'

interface PrivacySectionProps extends SectionProps {
  clearing: boolean
  cleared: boolean
  onClearData: () => void
}

export const PrivacySection = memo(function PrivacySection({
  draft,
  setDraft,
  clearing,
  cleared,
  onClearData,
}: PrivacySectionProps) {
  const { t } = useTranslation('settings')

  return (
    <div>
      <SectionHeader title={t('privacy.title')} description={t('privacy.description')} />
      <div className="bg-card rounded-xl border border-border px-4">
        <SettingRow label={t('privacy.clearData')} description={t('privacy.clearDataDesc')}>
          <button
            onClick={onClearData}
            disabled={clearing}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 disabled:opacity-50 bg-destructive/90 shadow-[0_4px_16px_var(--destructive-glow)] text-white"
          >
            {clearing ? (
              t('privacy.clearing')
            ) : cleared ? (
              <>
                <CheckCircle className="h-4 w-4" /> {t('privacy.done')}
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" /> {t('privacy.clear')}
              </>
            )}
          </button>
        </SettingRow>
        <SettingRow label={t('privacy.clearOnExit')} description={t('privacy.clearOnExitDesc')}>
          <Toggle
            checked={draft.clearOnExit}
            onChange={(v) => setDraft('clearOnExit', v)}
            label={t('privacy.clearOnExitLabel')}
          />
        </SettingRow>
        <SettingRow label={t('privacy.disableCache')} description={t('privacy.disableCacheDesc')}>
          <Toggle
            checked={draft.disableCache}
            onChange={(v) => setDraft('disableCache', v)}
            label={t('privacy.disableCacheLabel')}
          />
        </SettingRow>
        <SettingRow label={t('privacy.firstPartyIsolation')} description={t('privacy.firstPartyIsolationDesc')}>
          <Toggle
            checked={draft.firstPartyIsolation}
            onChange={(v) => setDraft('firstPartyIsolation', v)}
            label={t('privacy.firstPartyIsolationLabel')}
          />
        </SettingRow>
        <SettingRow label={t('privacy.cookieAutoDelete')} description={t('privacy.cookieAutoDeleteDesc')}>
          <Toggle
            checked={draft.cookieAutoDelete}
            onChange={(v) => setDraft('cookieAutoDelete', v)}
            label={t('privacy.cookieAutoDeleteLabel')}
          />
        </SettingRow>
        {draft.cookieAutoDelete && (
          <div className="ml-4 pl-4 border-l-2 border-border">
            <SettingRow label={t('privacy.autoDeleteTimeout')} description={t('privacy.autoDeleteTimeoutDesc')}>
              <div className="flex items-center">
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={draft.cookieAutoDeleteMinutes}
                  onChange={(e) => setDraft('cookieAutoDeleteMinutes', parseInt(e.target.value) || 30)}
                  className="w-20 px-3 py-1.5 rounded-lg border border-border bg-background text-foreground"
                />
                <span className="text-xs text-muted-foreground ml-1">min</span>
              </div>
            </SettingRow>
          </div>
        )}
      </div>
    </div>
  )
})
