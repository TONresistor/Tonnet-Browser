/**
 * Sidebar de la page Storage — carte flottante détachée style iOS / Telegram,
 * calquée sur SettingsSidebar : tuiles d'icône colorées (29px rounded-control),
 * groupes inset arrondis, hairlines inset, ligne active surlignée.
 *
 * Vue master : filtres + seeding + réglages.
 * Vue détail : inspecteur du bag sélectionné, avec bouton retour.
 */

import { ChevronRight, Plus, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import {
  openStorageSettings,
  useSavePreferences,
  useSeedingEnabled,
  useSetPreferenceDraft,
} from '@/features/settings/public'
import { browserNavigation } from '@/features/browser/navigation'
import { ActionButton } from '@/components/ui/ios/ActionButton'
import { Toggle } from '@/features/settings/components/shared/Toggle'
import { AppIcon } from '@/components/ui/AppIcon'
import type { StorageBag, BagDetails } from '@shared/types'
import type { FilterType } from './bag-filter'
import { BagInspector } from './BagInspector'

interface FilterDef {
  id: FilterType
  icon: 'storageFilterAll' | 'storageFilterDownload' | 'storageFilterComplete'
  tileClass: string
}

const FILTERS: FilterDef[] = [
  { id: 'all', icon: 'storageFilterAll', tileClass: 'bg-settings-purple text-identity-foreground' },
  { id: 'downloading', icon: 'storageFilterDownload', tileClass: 'bg-info text-info-foreground' },
  { id: 'complete', icon: 'storageFilterComplete', tileClass: 'bg-success text-success-foreground' },
]

interface StorageSidebarProps {
  filter: FilterType
  onFilterChange: (filter: FilterType) => void
  counts: Record<FilterType, number>
  onAddBag: () => void
  bag: StorageBag | null
  bagDetails: BagDetails | null
  loadingDetails: boolean
  detailTab: 'info' | 'files'
  onTabChange: (tab: 'info' | 'files') => void
  onOpenFolder: (bagId: string) => void
  onBrowseFiles: (bagId: string) => void
  onShowFile: (bagId: string, fileName: string) => void
  onCopyId: (bagId: string) => void
  onRemove: (bagId: string) => void
  onBack: () => void
}

export function StorageSidebar({
  filter,
  onFilterChange,
  counts,
  onAddBag,
  bag,
  bagDetails,
  loadingDetails,
  detailTab,
  onTabChange,
  onOpenFolder,
  onBrowseFiles,
  onShowFile,
  onCopyId,
  onRemove,
  onBack,
}: StorageSidebarProps) {
  const { t } = useTranslation('pages')
  const seedingEnabled = useSeedingEnabled()
  const setDraft = useSetPreferenceDraft()
  const save = useSavePreferences()

  const handleSeedingToggle = async (enabled: boolean) => {
    setDraft('seedingEnabled', enabled)
    await save()
  }

  const navigateToSettings = () => {
    openStorageSettings()
    browserNavigation.navigateActiveTab('ton://settings')
  }

  return (
    <div
      data-storage-sidebar
      className="m-3 flex w-[260px] shrink-0 flex-col overflow-hidden rounded-panel border border-border-subtle bg-elevation-1 shadow-panel"
    >
      {bag ? (
        <BagInspector
          bag={bag}
          bagDetails={bagDetails}
          loadingDetails={loadingDetails}
          detailTab={detailTab}
          onTabChange={onTabChange}
          onOpenFolder={onOpenFolder}
          onBrowseFiles={onBrowseFiles}
          onShowFile={onShowFile}
          onCopyId={onCopyId}
          onRemove={onRemove}
          onBack={onBack}
        />
      ) : (
        <>
          <div className="flex items-center justify-center gap-2 px-4 pb-3 pt-4">
            <AppIcon name="storage" className="h-6 w-6 text-icon" />
            <h2 className="text-[22px] font-bold tracking-tight text-heading">{t('storage.title')}</h2>
          </div>

          <div className="flex flex-1 flex-col overflow-y-auto px-3 pb-4">
            <ActionButton
              variant="filled"
              onClick={onAddBag}
              className="mb-5 w-full"
              icon={<Plus className="h-4 w-4" />}
            >
              {t('storage.actions.addBag')}
            </ActionButton>

            <div
              role="listbox"
              aria-label={t('storage.title')}
              className="overflow-hidden rounded-group bg-elevation-2"
            >
              {FILTERS.map((def, i) => {
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
                      className={cn(
                        'grid h-[29px] w-[29px] shrink-0 place-items-center rounded-control',
                        def.tileClass
                      )}
                    >
                      <AppIcon name={def.icon} className="h-[17px] w-[17px] text-identity-foreground" />
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

            <div className="mt-auto overflow-hidden rounded-group bg-elevation-2 pt-1">
              <div className="flex items-center gap-3 pl-3">
                <span className="grid h-[29px] w-[29px] shrink-0 place-items-center rounded-control bg-warning text-warning-foreground">
                  <Upload className="h-[17px] w-[17px] text-identity-foreground" />
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
                  <AppIcon name="settings" className="h-[17px] w-[17px] text-identity-foreground" />
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
        </>
      )}
    </div>
  )
}
