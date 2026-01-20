/**
 * Section paramètres réseau
 */

import { memo } from 'react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { Toggle } from '../shared/Toggle'
import { NumberInput } from '../shared/NumberInput'
import type { SectionProps } from '../types'

export const NetworkSection = memo(function NetworkSection({ draft, setDraft }: SectionProps) {
  return (
    <div>
      <SectionHeader title="Network" description="Proxy and connection settings" />
      <div className="bg-card rounded-xl border border-border px-4">
        <SettingRow label="Proxy port" description="Local port for TON proxy">
          <NumberInput
            value={draft.proxyPort}
            onChange={(v) => setDraft('proxyPort', v)}
            min={1024}
            max={65535}
          />
        </SettingRow>
        <SettingRow label="Storage API port" description="Local port for storage daemon">
          <NumberInput
            value={draft.storagePort}
            onChange={(v) => setDraft('storagePort', v)}
            min={1024}
            max={65535}
          />
        </SettingRow>
        <SettingRow label="Auto-connect" description="Connect to TON Network on startup">
          <Toggle
            checked={draft.autoConnect}
            onChange={(v) => setDraft('autoConnect', v)}
            label="Auto-connect to network"
          />
        </SettingRow>
        <SettingRow label="Connection timeout" description="Max time to wait for proxy startup">
          <NumberInput
            value={draft.connectionTimeout}
            onChange={(v) => setDraft('connectionTimeout', v)}
            min={10}
            max={120}
            suffix="sec"
          />
        </SettingRow>
        <SettingRow label="Sync check interval" description="How often to check DHT sync status">
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
