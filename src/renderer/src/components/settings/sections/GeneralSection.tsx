/**
 * Section paramètres généraux
 */

import { memo } from 'react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { Toggle } from '../shared/Toggle'
import { SelectInput } from '../shared/SelectInput'
import { GarlicRoutingDiagram } from '../shared/GarlicRoutingDiagram'
import type { SectionProps } from '../types'

export const GeneralSection = memo(function GeneralSection({ draft, setDraft }: SectionProps) {
  return (
    <div>
      <SectionHeader title="General" description="Basic browser settings" />

      {/* Anonymous Mode Section */}
      <div className="bg-card rounded-xl border border-border px-4">
        {/* Anonymous mode toggle */}
        <div className="py-4 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex-1 pr-4">
              <p className="text-foreground font-medium">Anonymous mode</p>
              <p className="text-muted-foreground text-sm mt-0.5">
                Route traffic through 3-hop garlic circuit
              </p>
            </div>
            <Toggle
              checked={draft.anonymousMode}
              onChange={(v) => setDraft('anonymousMode', v)}
              label="Enable anonymous mode"
            />
          </div>
        </div>

        {/* Circuit rotation - visible when anonymous mode is ON */}
        {draft.anonymousMode && (
          <>
            <div className="py-4 border-b border-border">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-foreground font-medium">Circuit rotation</p>
                  <p className="text-muted-foreground text-sm mt-0.5">
                    Automatically change circuit for better privacy
                  </p>
                </div>
                <Toggle
                  checked={draft.circuitRotation}
                  onChange={(v) => setDraft('circuitRotation', v)}
                  label="Enable circuit rotation"
                />
              </div>
            </div>

            {draft.circuitRotation && (
              <div className="py-4 border-b border-border">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-foreground font-medium">Rotation interval</p>
                    <p className="text-muted-foreground text-sm mt-0.5">
                      How often to build a new circuit
                    </p>
                  </div>
                  <select
                    value={draft.rotateInterval}
                    onChange={(e) => setDraft('rotateInterval', e.target.value)}
                    className="pl-4 pr-8 py-1.5 rounded-full text-sm text-foreground outline-none cursor-pointer bg-surface-hover border border-border-medium"
                  >
                    <option value="5m" className="bg-background text-foreground">
                      5 minutes
                    </option>
                    <option value="10m" className="bg-background text-foreground">
                      10 minutes
                    </option>
                    <option value="15m" className="bg-background text-foreground">
                      15 minutes
                    </option>
                    <option value="30m" className="bg-background text-foreground">
                      30 minutes
                    </option>
                  </select>
                </div>
              </div>
            )}
          </>
        )}

        {/* How it works - Garlic Routing Diagram */}
        <GarlicRoutingDiagram />
      </div>

      {/* Other General Settings */}
      <div className="mt-6 bg-card rounded-xl border border-border px-4">
        <SettingRow label="Homepage" description="Page to show when opening a new tab">
          <SelectInput
            value={draft.homepage}
            onChange={(v) => setDraft('homepage', v)}
            options={[
              { value: 'ton://start', label: 'Start Page' },
              { value: 'ton://storage', label: 'TON Storage' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Restore tabs" description="Reopen previous tabs on startup">
          <Toggle
            checked={draft.restoreTabs}
            onChange={(v) => setDraft('restoreTabs', v)}
            label="Restore tabs on startup"
          />
        </SettingRow>
      </div>
    </div>
  )
})
