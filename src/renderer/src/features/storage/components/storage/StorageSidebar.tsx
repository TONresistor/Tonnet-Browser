/**
 * Sidebar de la page Storage — carte flottante détachée style iOS / Telegram,
 * calquée sur SettingsSidebar : tuiles d'icône colorées (29px rounded-control),
 * groupes inset arrondis, hairlines inset, ligne active surlignée.
 *
 * Le bloc de filtres joue le rôle de "master" (All / Downloading / Complete avec
 * compteurs). En bas : toggle de seeding + lien vers les réglages.
 */

import { ArrowDownToLine, CheckCircle2, ChevronRight, HardDrive, Plus, Upload } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { useSavePreferences, useSeedingEnabled, useSetPreferenceDraft } from '@/features/settings/public'
import { browserNavigation } from '@/features/browser/navigation'
import { ActionButton } from '@/components/ui/ios/ActionButton'
import { Toggle } from '@/features/settings/components/shared/Toggle'
import { AppIcon } from '@/components/ui/AppIcon'
import type { FilterType } from './bag-filter'

interface FilterDef {
  id: FilterType
  icon: LucideIcon
  tileClass: string
}

const FILTERS: FilterDef[] = [
  { id: 'all', icon: HardDrive, tileClass: 'bg-secondary text-secondary-foreground' },
  { id: 'downloading', icon: ArrowDownToLine, tileClass: 'bg-info text-info-foreground' },
  { id: 'complete', icon: CheckCircle2, tileClass: 'bg-success text-success-foreground' },
]

interface StorageSidebarProps {
  filter: FilterType
  onFilterChange: (filter: FilterType) => void
  counts: Record<FilterType, number>
  onAddBag: () => void
}

export function StorageSidebar({ filter, onFilterChange, counts, onAddBag }: StorageSidebarProps) {
  const { t } = useTranslation('pages')
  const seedingEnabled = useSeedingEnabled()
  const setDraft = useSetPreferenceDraft()
  const save = useSavePreferences()

  const handleSeedingToggle = async (enabled: boolean) => {
    setDraft('seedingEnabled', enabled)
    await save()
  }

  const navigateToSettings = () => {
    browserNavigation.navigateActiveTab('ton://settings')
  }

  return (
    <div className="m-3 flex w-[260px] shrink-0 flex-col overflow-hidden rounded-panel border border-border-subtle bg-elevation-1 shadow-panel">
      {/* Header */}
      <div className="flex items-center justify-center gap-2 px-4 pb-3 pt-4">
        <AppIcon name="storage" className="h-6 w-6 text-icon" />
        <h2 className="text-[22px] font-bold tracking-tight text-heading">{t('storage.title')}</h2>
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto px-3 pb-4">
        {/* Add bag */}
        <ActionButton variant="filled" onClick={onAddBag} className="mb-5 w-full" icon={<Plus className="h-4 w-4" />}>
          {t('storage.actions.addBag')}
        </ActionButton>

        {/* Filters — master list */}
        <div role="listbox" aria-label={t('storage.title')} className="overflow-hidden rounded-group bg-elevation-2">
          {FILTERS.map((def, i) => {
            const Icon = def.icon
            const isActive = filter === def.id
            return (
              <button
                key={def.id}
                role="option"
                aria-selected={isActive}
                onClick={() => onFilterChange(def.id)}
                className={cn(
                  'flex w-full items-center gap-3 pl-3 text-left transition-colors',
                  isActive ? 'bg-[hsl(var(--primary)/0.14)]' : 'hover:bg-surface-hover'
                )}
              >
                <span
                  className={cn('grid h-[29px] w-[29px] shrink-0 place-items-center rounded-control', def.tileClass)}
                >
                  <Icon className="h-[17px] w-[17px]" />
                </span>
                <span
                  className={cn(
                    'flex h-[50px] min-w-0 flex-1 items-center gap-2 pr-3',
                    i > 0 && 'border-t border-border-subtle'
                  )}
                >
                  <span className="flex-1 truncate text-[15px] font-medium text-foreground">
                    {t(`storage.filters.${def.id}`)}
                  </span>
                  <span
                    className={cn(
                      'inline-flex h-5 min-w-[24px] items-center justify-center rounded-full px-1.5 text-xs font-medium tabular-nums',
                      isActive ? 'bg-foreground/10 text-foreground' : 'bg-elevation-3 text-muted-foreground'
                    )}
                  >
                    {counts[def.id]}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        {/* Bottom: seeding + settings */}
        <div className="mt-auto overflow-hidden rounded-group bg-elevation-2 pt-1">
          <div className="flex items-center gap-3 pl-3">
            <span className="grid h-[29px] w-[29px] shrink-0 place-items-center rounded-control bg-warning text-warning-foreground">
              <Upload className="h-[17px] w-[17px]" />
            </span>
            <span className="flex h-[50px] min-w-0 flex-1 items-center gap-2 pr-3">
              <span className="flex-1 truncate text-[15px] font-medium text-foreground">
                {t('storage.actions.seeding')}
              </span>
              <Toggle
                checked={!!seedingEnabled}
                onChange={handleSeedingToggle}
                ariaLabel={t('storage.actions.seeding')}
              />
            </span>
          </div>

          <button
            onClick={navigateToSettings}
            className="flex w-full items-center gap-3 pl-3 text-left transition-colors hover:bg-surface-hover"
          >
            <span className="grid h-[29px] w-[29px] shrink-0 place-items-center rounded-control bg-secondary text-secondary-foreground">
              <AppIcon name="settings" className="h-[17px] w-[17px]" />
            </span>
            <span className="flex h-[50px] min-w-0 flex-1 items-center gap-2 border-t border-border-subtle pr-3">
              <span className="flex-1 truncate text-[15px] font-medium text-foreground">
                {t('storage.actions.settings')}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
