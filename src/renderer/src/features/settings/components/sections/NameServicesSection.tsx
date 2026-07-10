import { memo } from 'react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { Toggle } from '../shared/Toggle'
import { TextInput } from '../shared/TextInput'
import type { SectionProps } from '../types'
import { useTranslation } from 'react-i18next'

export const NameServicesSection = memo(function NameServicesSection({ draft, setDraft }: SectionProps) {
  const { t } = useTranslation('settings')

  const resolverText = (key: string) => {
    const fallbackKey = key === 'title' ? 'chainResolvers' : key === 'description' ? 'chainResolversDesc' : key
    return t(`nameServices.${key}`, { defaultValue: t(`general.${fallbackKey}`) })
  }

  return (
    <div>
      <SectionHeader title={resolverText('title')} description={resolverText('description')} />

      <div className="settings-group px-4">
        <SettingRow label={resolverText('resolveEth')} description={resolverText('resolveEthDesc')}>
          <Toggle
            checked={draft.resolveEth}
            onChange={(v) => setDraft('resolveEth', v)}
            ariaLabel={resolverText('resolveEth')}
          />
        </SettingRow>
        {draft.resolveEth && (
          <SettingRow label={resolverText('ethRpc')} description={resolverText('ethRpcDesc')}>
            <TextInput
              value={draft.ethRpc}
              onChange={(v) => setDraft('ethRpc', v)}
              placeholder={resolverText('ethRpcPlaceholder')}
            />
          </SettingRow>
        )}

        <SettingRow label={resolverText('resolveSol')} description={resolverText('resolveSolDesc')}>
          <Toggle
            checked={draft.resolveSol}
            onChange={(v) => setDraft('resolveSol', v)}
            ariaLabel={resolverText('resolveSol')}
          />
        </SettingRow>
        {draft.resolveSol && (
          <SettingRow label={resolverText('solRpc')} description={resolverText('solRpcDesc')}>
            <TextInput
              value={draft.solRpc}
              onChange={(v) => setDraft('solRpc', v)}
              placeholder={resolverText('solRpcPlaceholder')}
            />
          </SettingRow>
        )}
      </div>
    </div>
  )
})
