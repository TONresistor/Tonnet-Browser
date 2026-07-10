/**
 * Pure helpers for the in-app bag file browser (ton://storage/browse/<bag>).
 * Ported from the standalone HTML browser so the logic is shared and tested:
 * virtual-folder building from flat file paths, sorting (folders first),
 * breadcrumb segmentation and file-type categorisation for icon selection.
 */

export type FileCategory = 'video' | 'audio' | 'image' | 'document' | 'archive' | 'code' | 'text' | 'folder' | 'other'

export interface RawFile {
  name: string
  size: number
}

export interface FolderEntry {
  kind: 'folder'
  name: string
  /** Aggregated size of all files under this folder. */
  size: number
  /** Number of files under this folder (recursive). */
  count: number
}

export interface FileEntry {
  kind: 'file'
  name: string
  size: number
  /** Full path within the bag, used to open the file. */
  fullPath: string
  category: FileCategory
}

export type Entry = FolderEntry | FileEntry

export type SortField = 'name' | 'size'

const CATEGORY_EXTENSIONS: Record<Exclude<FileCategory, 'folder' | 'other'>, string[]> = {
  video: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'ts'],
  audio: ['mp3', 'flac', 'ogg', 'wav', 'aac', 'wma', 'm4a', 'opus'],
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'],
  document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'zst'],
  code: [
    'js',
    'ts',
    'py',
    'go',
    'rs',
    'c',
    'cpp',
    'h',
    'java',
    'html',
    'css',
    'json',
    'xml',
    'yaml',
    'toml',
    'md',
    'sh',
  ],
  text: ['txt', 'log', 'csv', 'ini', 'cfg', 'conf'],
}

const EXT_MAP: Record<string, FileCategory> = {}
for (const [cat, exts] of Object.entries(CATEGORY_EXTENSIONS)) {
  for (const ext of exts) EXT_MAP[ext] = cat as FileCategory
}

export function getFileCategory(name: string): FileCategory {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return EXT_MAP[ext] || 'other'
}

/** Normalise a folder path to `/` or `/a/b/` (always leading + trailing slash). */
export function normalizePath(path: string): string {
  if (!path || path === '/') return '/'
  return '/' + path.replace(/^\/+/, '').replace(/\/+$/, '') + '/'
}

/**
 * Build the entries (virtual folders + files) directly contained in `path`.
 * Files deeper than `path` are collapsed into their immediate folder.
 */
export function buildEntries(files: RawFile[], path: string): Entry[] {
  const norm = normalizePath(path)
  const prefix = norm === '/' ? '' : norm.slice(1)
  const folders = new Map<string, FolderEntry>()
  const entries: Entry[] = []

  for (const f of files) {
    if (prefix && f.name.indexOf(prefix) !== 0) continue
    const rest = prefix ? f.name.slice(prefix.length) : f.name
    if (!rest) continue

    const slashIdx = rest.indexOf('/')
    if (slashIdx >= 0) {
      const folderName = rest.slice(0, slashIdx)
      let folder = folders.get(folderName)
      if (!folder) {
        folder = { kind: 'folder', name: folderName, size: 0, count: 0 }
        folders.set(folderName, folder)
        entries.push(folder)
      }
      folder.size += f.size
      folder.count++
    } else {
      entries.push({
        kind: 'file',
        name: rest,
        fullPath: f.name,
        size: f.size,
        category: getFileCategory(rest),
      })
    }
  }
  return entries
}

/** Sort entries with folders always first, then by the chosen field/direction. */
export function sortEntries(entries: Entry[], field: SortField, asc: boolean): Entry[] {
  const cmp = (a: Entry, b: Entry): number => {
    const r = field === 'size' ? a.size - b.size : a.name.localeCompare(b.name)
    return asc ? r : -r
  }
  const folders = entries.filter((e): e is FolderEntry => e.kind === 'folder').sort(cmp)
  const files = entries.filter((e): e is FileEntry => e.kind === 'file').sort(cmp)
  return [...folders, ...files]
}

export interface Crumb {
  name: string
  /** Normalised path this crumb navigates to. */
  path: string
}

/** Breadcrumb segments for `path`, starting at root. The last crumb is current. */
export function breadcrumbs(path: string): Crumb[] {
  const norm = normalizePath(path)
  const crumbs: Crumb[] = [{ name: 'root', path: '/' }]
  if (norm === '/') return crumbs
  const parts = norm.slice(1, -1).split('/')
  let built = '/'
  for (const part of parts) {
    built += part + '/'
    crumbs.push({ name: part, path: built })
  }
  return crumbs
}

/** Total file count and aggregated size for a set of entries. */
export function entryStats(entries: Entry[]): { fileCount: number; totalSize: number } {
  let fileCount = 0
  let totalSize = 0
  for (const e of entries) {
    totalSize += e.size
    fileCount += e.kind === 'folder' ? e.count : 1
  }
  return { fileCount, totalSize }
}
