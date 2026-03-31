import { useTranslation } from 'react-i18next'
import { FileText, Info, Folder, FolderOpen } from 'lucide-react'
import type { StorageBag } from '@shared/types'
import { cn } from '@/lib/utils'
import { formatBytes, formatSpeed } from '@/lib/format'

interface BagFile {
  name: string
  size: number
}

interface BagDetails {
  files: BagFile[]
  path: string
}

interface BagDetailPanelProps {
  bag: StorageBag
  bagDetails: BagDetails | null
  loadingDetails: boolean
  detailTab: 'info' | 'files'
  onTabChange: (tab: 'info' | 'files') => void
  onOpenFolder: (bagId: string) => void
  onBrowseFiles: (bagId: string) => void
  onShowFile: (bagId: string, fileName: string) => void
}

export function BagDetailPanel({
  bag,
  bagDetails,
  loadingDetails,
  detailTab,
  onTabChange,
  onOpenFolder,
  onBrowseFiles,
  onShowFile,
}: BagDetailPanelProps) {
  const { t } = useTranslation('pages')

  return (
    <div className="border-t border-border bg-background-secondary">
      {/* Tabs */}
      <div className="flex border-b border-border">
        <button
          onClick={() => onTabChange('info')}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            detailTab === 'info'
              ? 'text-primary border-primary'
              : 'text-muted-foreground border-transparent hover:text-foreground'
          )}
        >
          <Info className="h-4 w-4 inline mr-2" />
          {t('storage.tabs.info')}
        </button>
        <button
          onClick={() => onTabChange('files')}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            detailTab === 'files'
              ? 'text-primary border-primary'
              : 'text-muted-foreground border-transparent hover:text-foreground'
          )}
        >
          <FileText className="h-4 w-4 inline mr-2" />
          {t('storage.tabs.files')}
        </button>
      </div>

      {/* Tab Content */}
      <div className="p-4 max-h-48 overflow-auto">
        {detailTab === 'info' ? (
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <div className="flex">
              <span className="text-muted-foreground w-24">{t('storage.info.id')}</span>
              <span className="text-foreground/80 font-mono text-xs break-all">{bag.id}</span>
            </div>
            <div className="flex">
              <span className="text-muted-foreground w-24">{t('storage.info.size')}</span>
              <span className="text-foreground">{formatBytes(bag.size)}</span>
            </div>
            <div className="flex">
              <span className="text-muted-foreground w-24">{t('storage.info.downloaded')}</span>
              <span className="text-foreground">{formatBytes(bag.downloaded)}</span>
            </div>
            <div className="flex">
              <span className="text-muted-foreground w-24">{t('storage.info.status')}</span>
              <span className="text-foreground">{t(`storage.status.${bag.status}`, bag.status)}</span>
            </div>
            <div className="flex">
              <span className="text-muted-foreground w-24">{t('storage.info.peers')}</span>
              <span className="text-foreground">{bag.peers}</span>
            </div>
            <div className="flex">
              <span className="text-muted-foreground w-24">{t('storage.info.files')}</span>
              <span className="text-foreground">{bag.filesCount ?? '-'}</span>
            </div>
            <div className="flex">
              <span className="text-muted-foreground w-24">{t('storage.info.download')}</span>
              <span className="text-foreground">{formatSpeed(bag.downloadSpeed)}</span>
            </div>
            <div className="flex">
              <span className="text-muted-foreground w-24">{t('storage.info.upload')}</span>
              <span className="text-foreground">{formatSpeed(bag.uploadSpeed)}</span>
            </div>
            <div className="flex col-span-2">
              <span className="text-muted-foreground w-24 flex-shrink-0">{t('storage.info.path')}</span>
              <button
                onClick={() => onOpenFolder(bag.id)}
                className="flex items-center gap-2 text-muted-foreground text-xs hover:text-primary transition-colors cursor-pointer group text-left"
              >
                <span className="break-all">{bagDetails?.path || bag.id}</span>
                <FolderOpen className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              </button>
            </div>
            <div className="col-span-2 mt-2">
              <button
                onClick={() => onBrowseFiles(bag.id)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <FileText className="h-3.5 w-3.5" />
                {t('storage.actions.browseFiles')}
              </button>
            </div>
          </div>
        ) : loadingDetails ? (
          <div className="text-muted-foreground text-sm flex items-center gap-2">
            <Folder className="h-4 w-4 animate-pulse" />
            <span>{t('storage.loadingFiles')}</span>
          </div>
        ) : bagDetails && bagDetails.files.length > 0 ? (
          <div className="space-y-1">
            {bagDetails.files.map((file, idx) => (
              <div
                key={idx}
                onClick={() => onShowFile(bag.id, file.name)}
                className="flex items-center gap-3 text-sm py-1 px-2 rounded hover:bg-background cursor-pointer group"
              >
                <FileText className="h-4 w-4 text-primary flex-shrink-0" />
                <span className="text-foreground truncate flex-1">{file.name}</span>
                <FolderOpen className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                <span className="text-muted-foreground text-xs">{formatBytes(file.size)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-muted-foreground text-sm flex items-center gap-2">
            <Folder className="h-4 w-4" />
            <span>{t('storage.noFiles')}</span>
          </div>
        )}
      </div>
    </div>
  )
}
