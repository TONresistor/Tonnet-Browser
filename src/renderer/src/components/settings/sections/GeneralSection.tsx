/**
 * Section paramètres généraux
 */

import { memo } from 'react'
import { Home, HardDrive, Rows3, Columns3 } from 'lucide-react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { Toggle } from '../shared/Toggle'
import { Segmented } from '@/components/ui/ios/Segmented'
import { SelectInput } from '../shared/SelectInput'
import { GroupHeader } from '../shared/GroupHeader'
import { TextInput } from '../shared/TextInput'
import type { SectionProps } from '../types'
import { useTranslation } from 'react-i18next'

export const GeneralSection = memo(function GeneralSection({ draft, setDraft }: SectionProps) {
  const { t } = useTranslation('settings')

  return (
    <div>
      <SectionHeader title={t('general.title')} description={t('general.description')} />

      {/* Anonymous Mode */}
      <div className="settings-group px-4">
        <SettingRow label={t('general.anonymousMode')} description={t('general.anonymousModeDesc')}>
          <Toggle
            checked={draft.anonymousMode}
            onChange={(v) => setDraft('anonymousMode', v)}
            ariaLabel={t('general.enableAnonymousMode')}
          />
        </SettingRow>
        {draft.anonymousMode && (
          <SettingRow label={t('general.tunnelMode')} description={t('general.tunnelModeDesc')}>
            <Segmented
              value={draft.tunnelMode}
              onChange={(v) => setDraft('tunnelMode', v)}
              options={[
                { value: 'standard', label: t('general.tunnelStandard') },
                { value: 'maximum', label: t('general.tunnelMaximum') },
              ]}
            />
          </SettingRow>
        )}
      </div>

      {/* Settings */}
      <div className="mt-6 settings-group px-4">
        <SettingRow label={t('network.autoConnect')} description={t('network.autoConnectDesc')}>
          <Toggle
            checked={draft.autoConnect}
            onChange={(v) => setDraft('autoConnect', v)}
            ariaLabel={t('network.autoConnectLabel')}
          />
        </SettingRow>
        <SettingRow label={t('appearance.language.label')} description={t('appearance.language.description')}>
          <SelectInput
            value={draft.language}
            onChange={(v) => setDraft('language', v)}
            options={[
              { value: 'en', label: t('appearance.language.english') },
              { value: 'ru', label: t('appearance.language.russian') },
              { value: 'zh', label: t('appearance.language.chinese') },
              { value: 'es', label: t('appearance.language.spanish') },
              { value: 'id', label: t('appearance.language.indonesian') },
              { value: 'th', label: t('appearance.language.thai') },
              { value: 'de', label: t('appearance.language.german') },
              { value: 'fr', label: t('appearance.language.french') },
              { value: 'pt', label: t('appearance.language.portuguese') },
              { value: 'ko', label: t('appearance.language.korean') },
            ]}
          />
        </SettingRow>
        <SettingRow label={t('general.homepage')} description={t('general.homepageDesc')}>
          <Segmented
            value={draft.homepage}
            onChange={(v) => setDraft('homepage', v)}
            options={[
              { value: 'ton://start', label: t('general.startPage'), icon: <Home className="h-3.5 w-3.5" /> },
              { value: 'ton://storage', label: t('general.tonStorage'), icon: <HardDrive className="h-3.5 w-3.5" /> },
            ]}
          />
        </SettingRow>
        <SettingRow label={t('appearance.ui.tabOrientation')} description={t('appearance.ui.tabOrientationDesc')}>
          <Segmented
            value={draft.tabOrientation}
            onChange={(v) => setDraft('tabOrientation', v as 'horizontal' | 'vertical')}
            options={[
              {
                value: 'horizontal',
                label: t('appearance.ui.tabOrientationHorizontal'),
                icon: <Columns3 className="h-3.5 w-3.5" />,
              },
              {
                value: 'vertical',
                label: t('appearance.ui.tabOrientationVertical'),
                icon: <Rows3 className="h-3.5 w-3.5" />,
              },
            ]}
          />
        </SettingRow>
        <SettingRow label={t('privacy.clearOnExit')} description={t('privacy.clearOnExitDesc')}>
          <Toggle
            checked={draft.clearOnExit}
            onChange={(v) => setDraft('clearOnExit', v)}
            ariaLabel={t('privacy.clearOnExitLabel')}
          />
        </SettingRow>
      </div>

      {/* Chain resolvers */}
      <div className="mt-6 settings-group px-4">
        <GroupHeader title={t('general.chainResolvers')} description={t('general.chainResolversDesc')} />

        {/* Ethereum */}
        <SettingRow label={t('general.resolveEth')} description={t('general.resolveEthDesc')}>
          <Toggle
            checked={draft.resolveEth}
            onChange={(v) => setDraft('resolveEth', v)}
            ariaLabel={t('general.resolveEth')}
          />
        </SettingRow>
        {draft.resolveEth && (
          <SettingRow label={t('general.ethRpc')} description={t('general.ethRpcDesc')}>
            <TextInput
              value={draft.ethRpc}
              onChange={(v) => setDraft('ethRpc', v)}
              placeholder={t('general.ethRpcPlaceholder')}
            />
          </SettingRow>
        )}

        {/* Solana */}
        <SettingRow label={t('general.resolveSol')} description={t('general.resolveSolDesc')}>
          <Toggle
            checked={draft.resolveSol}
            onChange={(v) => setDraft('resolveSol', v)}
            ariaLabel={t('general.resolveSol')}
          />
        </SettingRow>
        {draft.resolveSol && (
          <SettingRow label={t('general.solRpc')} description={t('general.solRpcDesc')}>
            <TextInput
              value={draft.solRpc}
              onChange={(v) => setDraft('solRpc', v)}
              placeholder={t('general.solRpcPlaceholder')}
            />
          </SettingRow>
        )}
      </div>
    </div>
  )
})
