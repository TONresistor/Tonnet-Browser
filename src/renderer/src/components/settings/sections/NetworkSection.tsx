/**
 * Section paramètres réseau
 */

import { memo } from 'react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { Toggle } from '../shared/Toggle'
import { NumberInput } from '../shared/NumberInput'
import type { SectionProps } from '../types'
import { useTranslation } from 'react-i18next'

export const NetworkSection = memo(function NetworkSection({ draft, setDraft }: SectionProps) {
  const { t } = useTranslation('settings')

  return (
    <div>
      <SectionHeader title={t('network.title')} description={t('network.description')} />
      <div className="glass-card px-4">
        <SettingRow label={t('network.proxyPort')} description={t('network.proxyPortDesc')}>
          <NumberInput value={draft.proxyPort} onChange={(v) => setDraft('proxyPort', v)} min={1024} max={65535} />
        </SettingRow>
        <SettingRow label={t('network.storageApiPort')} description={t('network.storageApiPortDesc')}>
          <NumberInput value={draft.storagePort} onChange={(v) => setDraft('storagePort', v)} min={1024} max={65535} />
        </SettingRow>
        <SettingRow label={t('network.autoConnect')} description={t('network.autoConnectDesc')}>
          <Toggle
            checked={draft.autoConnect}
            onChange={(v) => setDraft('autoConnect', v)}
            label={t('network.autoConnectLabel')}
          />
        </SettingRow>
        <SettingRow label={t('network.connectionTimeout')} description={t('network.connectionTimeoutDesc')}>
          <NumberInput
            value={draft.connectionTimeout}
            onChange={(v) => setDraft('connectionTimeout', v)}
            min={10}
            max={120}
            suffix="sec"
          />
        </SettingRow>
        <SettingRow label={t('network.syncCheckInterval')} description={t('network.syncCheckIntervalDesc')}>
          <NumberInput
            value={draft.syncCheckInterval}
            onChange={(v) => setDraft('syncCheckInterval', v)}
            min={1000}
            max={10000}
            step={500}
            suffix="ms"
          />
        </SettingRow>
      </div>
    </div>
  )
})
