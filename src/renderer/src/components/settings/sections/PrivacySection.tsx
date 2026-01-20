/**
 * Section Privacy
 */

import { memo } from 'react'
import { Trash2, CheckCircle } from 'lucide-react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { Toggle } from '../shared/Toggle'
import type { SectionProps } from '../types'

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
  return (
    <div>
      <SectionHeader title="Privacy" description="Privacy and data settings" />
      <div className="bg-card rounded-xl border border-border px-4">
        <SettingRow
          label="Clear browsing data"
          description="Delete cache, cookies, and local storage"
        >
          <button
            onClick={onClearData}
            disabled={clearing}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 disabled:opacity-50 bg-destructive/90 shadow-[0_4px_16px_var(--destructive-glow)] text-white"
          >
            {clearing ? (
              'Clearing...'
            ) : cleared ? (
              <>
                <CheckCircle className="h-4 w-4" /> Done
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" /> Clear
              </>
            )}
          </button>
        </SettingRow>
        <SettingRow
          label="Clear on exit"
          description="Automatically clear data when closing browser"
        >
          <Toggle
            checked={draft.clearOnExit}
            onChange={(v) => setDraft('clearOnExit', v)}
            label="Clear data when closing browser"
          />
        </SettingRow>
        <SettingRow
          label="Disable cache"
          description="Force reload all resources (slower but more private)"
        >
          <Toggle
            checked={draft.disableCache}
            onChange={(v) => setDraft('disableCache', v)}
            label="Disable HTTP cache"
          />
        </SettingRow>
        <SettingRow
          label="First-party isolation"
          description="Isolate cookies and localStorage per domain (Tier S)"
        >
          <Toggle
            checked={draft.firstPartyIsolation}
            onChange={(v) => setDraft('firstPartyIsolation', v)}
            label="Enable first-party isolation"
          />
        </SettingRow>
        <SettingRow
          label="Cookie auto-delete"
          description="Automatically delete cookies after inactivity (Tier A)"
        >
          <Toggle
            checked={draft.cookieAutoDelete}
            onChange={(v) => setDraft('cookieAutoDelete', v)}
            label="Enable cookie auto-delete"
          />
        </SettingRow>
        {draft.cookieAutoDelete && (
          <SettingRow
            label="Auto-delete timeout"
            description="Minutes of inactivity before deleting cookies"
          >
            <input
              type="number"
              min={1}
              max={1440}
              value={draft.cookieAutoDeleteMinutes}
              onChange={(e) => setDraft('cookieAutoDeleteMinutes', parseInt(e.target.value) || 30)}
              className="w-20 px-3 py-1.5 rounded-lg border border-border bg-background text-foreground"
            />
          </SettingRow>
        )}
      </div>
    </div>
  )
})
