/**
 * Inspecteur de bag — vue drill-down dans la sidebar gauche.
 * Remplace filtres / seeding ; retour via le bouton back (ou Escape).
 */

import { useEffect } from 'react'
import { ChevronLeft, ChevronRight, Copy, FileText, FolderOpen, Info, Loader2, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import type { StorageBag, BagDetails } from '@shared/types'
import { cn } from '@/lib/utils'
import { formatBytes, formatSpeed } from '@/lib/format'
import { useTranslation } from 'react-i18next'
import { InsetGroup } from '@/components/ui/ios/InsetGroup'
import { Segmented } from '@/components/ui/ios/Segmented'

interface BagInspectorProps {
  bag: StorageBag
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

function KV({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-3 py-1.5 last:border-0">
      <span className="shrink-0 text-[12px] text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-[13px] text-foreground">{value}</span>
    </div>
  )
}

function ActionRow({
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
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] font-medium transition-colors hover:bg-surface-hover',
        danger ? 'text-destructive' : 'text-foreground'
      )}
    >
      <span className={cn('shrink-0', danger ? 'text-destructive' : 'text-muted-foreground')}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {!danger && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />}
    </button>
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
  onBack,
}: BagInspectorProps) {
  const { t } = useTranslation('pages')
  const { t: tc } = useTranslation('common')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])

  const progress = bag.size > 0 ? Math.min(100, (bag.downloaded / bag.size) * 100) : 0
  const isDownloading = bag.status === 'downloading' && progress < 100

  const summaryParts: string[] = []
  if (isDownloading) summaryParts.push(`${Math.round(progress)}%`, formatSpeed(bag.downloadSpeed))
  else if (bag.status === 'seeding') summaryParts.push(t('storage.status.completed'))
  else if (bag.status === 'paused') summaryParts.push(t('storage.status.paused'))
  else if (bag.status === 'error') summaryParts.push(t('storage.status.error'))
  summaryParts.push(formatBytes(bag.size))
  if (bag.peers > 0) summaryParts.push(`${bag.peers} ${t('storage.table.peers').toLowerCase()}`)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-2 pb-2 pt-3">
        <button
          type="button"
          onClick={onBack}
          title={tc('buttons.back')}
          aria-label={tc('buttons.back')}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1 pr-2">
          <h3 className="truncate text-[15px] font-semibold text-heading">{bag.name}</h3>
          <p className="truncate text-[12px] text-muted-foreground">{summaryParts.join(' · ')}</p>
        </div>
      </div>

      {isDownloading && (
        <div className="px-3 pb-2">
          <div className="h-1 overflow-hidden rounded-full bg-elevation-3">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <div className="overflow-hidden rounded-group bg-elevation-2">
          <ActionRow
            icon={<FileText className="h-4 w-4" />}
            label={t('storage.actions.browseFiles')}
            onClick={() => onBrowseFiles(bag.id)}
          />
          <ActionRow
            icon={<FolderOpen className="h-4 w-4" />}
            label={t('storage.actions.openFolder')}
            onClick={() => onOpenFolder(bag.id)}
          />
          <ActionRow
            icon={<Copy className="h-4 w-4" />}
            label={t('storage.actions.copyBagId')}
            onClick={() => onCopyId(bag.id)}
          />
          <ActionRow
            icon={<Trash2 className="h-4 w-4" />}
            label={t('storage.actions.remove')}
            onClick={() => onRemove(bag.id)}
            danger
          />
        </div>

        <div className="mt-3 px-0.5">
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

        <div className="mt-2">
          {detailTab === 'info' ? (
            <InsetGroup>
              <KV
                label={t('storage.info.downloaded')}
                value={`${formatBytes(bag.downloaded)} / ${formatBytes(bag.size)}`}
              />
              <KV label={t('storage.info.status')} value={t(`storage.status.${bag.status}`, bag.status)} />
              <KV label={t('storage.info.peers')} value={bag.peers} />
              <KV label={t('storage.info.files')} value={bag.filesCount ?? '-'} />
              <KV label={t('storage.info.download')} value={formatSpeed(bag.downloadSpeed)} />
              <KV label={t('storage.info.upload')} value={formatSpeed(bag.uploadSpeed)} />
              <KV label={t('storage.info.id')} value={<span className="font-mono text-[11px]">{bag.id}</span>} />
              <button
                type="button"
                onClick={() => onOpenFolder(bag.id)}
                className="group flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left transition-colors hover:bg-surface-hover"
              >
                <span className="shrink-0 text-[12px] text-muted-foreground">{t('storage.info.path')}</span>
                <span className="flex min-w-0 items-center gap-1 text-[12px] text-muted-foreground group-hover:text-foreground">
                  <span className="truncate">{bagDetails?.path || bag.id}</span>
                  <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                </span>
              </button>
            </InsetGroup>
          ) : loadingDetails ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t('storage.loadingFiles')}</span>
            </div>
          ) : bagDetails && bagDetails.files.length > 0 ? (
            <InsetGroup bodyClassName="py-0.5">
              {bagDetails.files.map((file, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onShowFile(bag.id, file.name)}
                  className="flex w-full items-center gap-2 border-b border-border-subtle px-3 py-1.5 text-left text-[13px] last:border-0 hover:bg-surface-hover"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate text-foreground">{file.name}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
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
    </div>
  )
}
