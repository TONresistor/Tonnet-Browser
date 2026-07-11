import { z } from 'zod'
import { defineRequest } from './definition'
import { BOOKMARKS_CHANNELS } from './channels'

const IdentifierSchema = z.string().min(1).max(256)

export const BookmarkFolderSchema = z.object({
  id: IdentifierSchema,
  name: z.string().max(512),
  parentId: IdentifierSchema.nullable(),
  createdAt: z.number().finite().nonnegative(),
  order: z.number().int().nonnegative(),
})

export const BookmarkSchema = z.object({
  id: IdentifierSchema,
  url: z.string().min(1).max(16_384),
  title: z.string().max(4_096),
  favicon: z.string().max(1_048_576).optional(),
  folderId: IdentifierSchema.nullable(),
  createdAt: z.number().finite().nonnegative(),
  order: z.number().int().nonnegative(),
})

export const BookmarksDataSchema = z.object({
  bookmarks: z.array(BookmarkSchema).max(10_000),
  folders: z.array(BookmarkFolderSchema).max(10_000),
})

export type Bookmark = z.infer<typeof BookmarkSchema>
export type BookmarkFolder = z.infer<typeof BookmarkFolderSchema>
export type BookmarksData = z.infer<typeof BookmarksDataSchema>

export const bookmarksLoadContract = defineRequest({
  channel: BOOKMARKS_CHANNELS.load,
  direction: 'request',
  caller: 'main-renderer',
  authorization: 'main-window',
  rateLimit: { kind: 'none' },
  input: z.tuple([]),
  output: BookmarksDataSchema,
  errors: ['BOOKMARKS_LOAD_FAILED'],
  redaction: 'sensitive',
})

export const bookmarksSaveContract = defineRequest({
  channel: BOOKMARKS_CHANNELS.save,
  direction: 'request',
  caller: 'main-renderer',
  authorization: 'main-window',
  rateLimit: { kind: 'none' },
  input: z.tuple([BookmarksDataSchema]),
  output: z.object({ success: z.literal(true) }),
  errors: ['INVALID_BOOKMARKS_DATA', 'BOOKMARKS_SAVE_FAILED'],
  redaction: 'sensitive',
})

export const BOOKMARKS_IPC_CONTRACTS = [bookmarksLoadContract, bookmarksSaveContract] as const
