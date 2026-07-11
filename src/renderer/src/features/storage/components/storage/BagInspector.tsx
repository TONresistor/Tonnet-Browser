/**
 * Inspecteur de bag — barre flottante détachée ancrée en bas du contenu.
 *
 * Repliée : résumé du bag sélectionné + actions rapides. Dépliée (« Détails ») :
 * la barre grandit vers le haut et révèle les onglets Info / Fichiers.
 */

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Copy, FileText, FolderOpen, Info, Loader2, Trash2, X } from 'lucide-react'
import type { ReactNode } from 'react'
import type { StorageBag, BagDetails } from '@shared/types'
import { cn } from '@/lib/utils'
import { formatBytes, formatSpeed } from '@/lib/format'
import { useTranslation } from 'react-i18next'
import { InsetGroup } from '@/components/ui/ios/InsetGroup'
import { Segmented } from '@/components/ui/ios/Segmented'

interface BagInspectorProps {
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
  onClose: () => void
}

function IconButton({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors',
        danger ? 'hover:bg-destructive/10 hover:text-destructive' : 'hover:bg-surface hover:text-foreground'
      )}
    >
      {icon}
    </button>
  )
}

// Key/value cell for the two-column info grid. `i` drives the matrix borders:
// every cell gets a bottom hairline, left-column cells (even index) a right one.
function KV({ label, value, i }: { label: string; value: ReactNode; i: number }) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-2',
        i % 2 === 0 && 'border-r'
      )}
    >
      <span className="shrink-0 text-[13px] text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-[14px] text-foreground">{value}</span>
    </div>
  )
}

export function BagInspector({
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
  onClose,
}: BagInspectorProps) {
  const { t } = useTranslation('pages')
  const [expanded, setExpanded] = useState(false)

  // Collapse + close on Escape; collapse whenever a different bag is selected.
  useEffect(() => {
    setExpanded(false)
  }, [bag?.id])

  useEffect(() => {
    if (!bag) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [bag, onClose])

  if (!bag) return null

  const progress = bag.size > 0 ? Math.min(100, (bag.downloaded / bag.size) * 100) : 0
  const isDownloading = bag.status === 'downloading' && progress < 100

  // Compact summary line under the name.
  const summaryParts: string[] = []
  if (isDownloading) summaryParts.push(`${Math.round(progress)}%`, formatSpeed(bag.downloadSpeed))
  else if (bag.status === 'seeding') summaryParts.push(t('storage.status.completed'))
  else if (bag.status === 'paused') summaryParts.push(t('storage.status.paused'))
  else if (bag.status === 'error') summaryParts.push(t('storage.status.error'))
  summaryParts.push(formatBytes(bag.size))
  if (bag.peers > 0) summaryParts.push(`${bag.peers} ${t('storage.table.peers').toLowerCase()}`)

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 px-6">
      <div className="pointer-events-auto w-full overflow-hidden rounded-panel border border-border-subtle bg-elevation-2/95 shadow-panel backdrop-blur">
        {/* Expanded detail (grows upward, above the bar) */}
        {expanded && (
          <div className="border-b border-border-subtle">
            <div className="px-3 pt-3">
              <Segmented<'info' | 'files'>
                value={detailTab}
                onChange={onTabChange}
                fullWidth
                ariaLabel={bag.name}
                options={[
                  { value: 'info', label: t('storage.tabs.info'), icon: <Info className="h-3.5 w-3.5" /> },
                  { value: 'files', label: t('storage.tabs.files'), icon: <FileText className="h-3.5 w-3.5" /> },
                ]}
              />
            </div>

            <div className="max-h-[40vh] overflow-auto p-3">
              {detailTab === 'info' ? (
                <InsetGroup>
                  <div className="grid grid-cols-2">
                    <KV
                      label={t('storage.info.downloaded')}
                      value={`${formatBytes(bag.downloaded)} / ${formatBytes(bag.size)}`}
                      i={0}
                    />
                    <KV label={t('storage.info.status')} value={t(`storage.status.${bag.status}`, bag.status)} i={1} />
                    <KV label={t('storage.info.peers')} value={bag.peers} i={2} />
                    <KV label={t('storage.info.files')} value={bag.filesCount ?? '-'} i={3} />
                    <KV label={t('storage.info.download')} value={formatSpeed(bag.downloadSpeed)} i={4} />
                    <KV label={t('storage.info.upload')} value={formatSpeed(bag.uploadSpeed)} i={5} />

                    {/* ID + path span the full width */}
                    <div className="col-span-2 flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-2">
                      <span className="shrink-0 text-[13px] text-muted-foreground">{t('storage.info.id')}</span>
                      <span className="min-w-0 truncate text-right font-mono text-xs text-foreground">{bag.id}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenFolder(bag.id)}
                      className="group col-span-2 flex items-center justify-between gap-3 px-4 py-2 text-left transition-colors hover:bg-surface-hover"
                    >
                      <span className="shrink-0 text-[13px] text-muted-foreground">{t('storage.info.path')}</span>
                      <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground group-hover:text-foreground">
                        <span className="truncate">{bagDetails?.path || bag.id}</span>
                        <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                      </span>
                    </button>
                  </div>
                </InsetGroup>
              ) : loadingDetails ? (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{t('storage.loadingFiles')}</span>
                </div>
              ) : bagDetails && bagDetails.files.length > 0 ? (
                <InsetGroup bodyClassName="py-1">
                  {bagDetails.files.map((file, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => onShowFile(bag.id, file.name)}
                      className="group flex w-full items-center gap-3 border-b border-border-subtle px-3 py-2 text-left text-sm transition-colors last:border-0 hover:bg-surface-hover"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1 truncate text-foreground">{file.name}</span>
                      <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {formatBytes(file.size)}
                      </span>
                    </button>
                  ))}
                </InsetGroup>
              ) : (
                <div className="py-6 text-center text-sm text-muted-foreground">{t('storage.noFiles')}</div>
              )}
            </div>
          </div>
        )}

        {/* Summary bar (always visible) */}
        <div className="flex items-center gap-1.5 py-1.5 pl-3 pr-1.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold text-foreground">{bag.name}</p>
            <p className="truncate text-[12px] text-muted-foreground">{summaryParts.join(' · ')}</p>
          </div>

          <IconButton
            icon={<FileText className="h-4 w-4" />}
            label={t('storage.actions.browseFiles')}
            onClick={() => onBrowseFiles(bag.id)}
          />
          <IconButton
            icon={<FolderOpen className="h-4 w-4" />}
            label={t('storage.actions.openFolder')}
            onClick={() => onOpenFolder(bag.id)}
          />
          <IconButton
            icon={<Copy className="h-4 w-4" />}
            label={t('storage.actions.copyBagId')}
            onClick={() => onCopyId(bag.id)}
          />
          <IconButton
            icon={<Trash2 className="h-4 w-4" />}
            label={t('storage.actions.remove')}
            onClick={() => onRemove(bag.id)}
            danger
          />

          <span className="mx-0.5 h-5 w-px shrink-0 bg-border-subtle" />

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-surface px-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-surface-hover"
          >
            {t('storage.actions.details')}
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
          <IconButton icon={<X className="h-4 w-4" />} label={t('storage.addModal.cancel')} onClick={onClose} />
        </div>
      </div>
    </div>
  )
}
