import { z } from 'zod'
import { STORAGE_CHANNELS } from './channels'
import { defineEvent, defineRequest } from './definition'

export const BagIdSchema = z.string().regex(/^[a-fA-F0-9]{64}$/)
export const RelativeBagPathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine(
    (value) =>
      !value.includes('\0') &&
      !value.startsWith('/') &&
      !value.startsWith('\\') &&
      !value.split(/[\\/]+/).some((part) => part === '..'),
    { message: 'Path must be relative and traversal-free' }
  )
export const BagFileNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => !value.includes('\0') && !value.includes('/') && !value.includes('\\') && !value.includes('..'), {
    message: 'File name must not contain separators or traversal segments',
  })
export const StorageBagSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  size: z.number().nonnegative(),
  downloaded: z.number().nonnegative(),
  uploadSpeed: z.number().nonnegative(),
  downloadSpeed: z.number().nonnegative(),
  peers: z.number().int().nonnegative(),
  filesCount: z.number().int().nonnegative(),
  status: z.enum(['downloading', 'seeding', 'paused', 'error']),
})
export const BagDetailsSchema = z.object({
  bag_id: z.string(),
  description: z.string(),
  files: z.array(z.object({ name: z.string(), size: z.number().nonnegative() })),
  peers: z.array(
    z.object({ addr: z.string(), download_speed: z.number().nonnegative(), upload_speed: z.number().nonnegative() })
  ),
  merkle_hash: z.string(),
  piece_size: z.number().nonnegative(),
  path: z.string(),
  downloaded: z.number().nonnegative(),
  size: z.number().nonnegative(),
  active: z.boolean(),
  seeding: z.boolean(),
  dir_name: z.string().optional(),
})
const MutationSchema = z.object({ success: z.literal(true) })
const base = {
  direction: 'request' as const,
  caller: 'main-renderer' as const,
  authorization: 'main-window' as const,
  rateLimit: { kind: 'none' as const },
  redaction: 'sensitive' as const,
}
const DownloadPathSchema = z
  .string()
  .min(1)
  .max(32_768)
  .refine((value) => !value.includes('\0'))
const bagMutation = <const TChannel extends string>(channel: TChannel) =>
  defineRequest({
    ...base,
    channel,
    input: z.tuple([BagIdSchema]),
    output: z.object({ success: z.boolean() }),
    errors: ['INVALID_BAG_ID', 'STORAGE_OPERATION_FAILED'],
  })
export const storageAddBagContract = defineRequest({
  ...base,
  channel: STORAGE_CHANNELS.addBag,
  rateLimit: { kind: 'fixed-window', maxRequests: 10, windowMs: 1_000, key: 'sender' },
  input: z.tuple([BagIdSchema, z.string().max(512).optional()]),
  output: z.object({ success: z.literal(true), bag: StorageBagSchema }),
  errors: ['RATE_LIMITED', 'INVALID_BAG_ID', 'STORAGE_ADD_FAILED'],
})
export const storageRemoveBagContract = bagMutation(STORAGE_CHANNELS.removeBag)
export const storagePauseBagContract = bagMutation(STORAGE_CHANNELS.pauseBag)
export const storageListBagsContract = defineRequest({
  ...base,
  channel: STORAGE_CHANNELS.listBags,
  input: z.tuple([]),
  output: z.object({ success: z.literal(true), bags: z.array(StorageBagSchema) }),
  errors: ['STORAGE_LIST_FAILED'],
})
export const storageGetDetailsContract = defineRequest({
  ...base,
  channel: STORAGE_CHANNELS.getDetails,
  input: z.tuple([BagIdSchema]),
  output: z.object({ success: z.literal(true), details: BagDetailsSchema }),
  errors: ['INVALID_BAG_ID', 'STORAGE_DETAILS_FAILED'],
})
export const storageOpenFolderContract = defineRequest({
  ...base,
  channel: STORAGE_CHANNELS.openFolder,
  input: z.tuple([BagIdSchema]),
  output: MutationSchema,
  errors: ['INVALID_BAG_ID', 'PATH_OUTSIDE_DOWNLOAD_DIRECTORY', 'OPEN_FOLDER_FAILED'],
})
export const storageReadFileContract = defineRequest({
  ...base,
  channel: STORAGE_CHANNELS.readFile,
  input: z.tuple([BagIdSchema, RelativeBagPathSchema]),
  output: z.object({
    success: z.literal(true),
    content: z.string(),
    truncated: z.boolean(),
    size: z.number().nonnegative(),
  }),
  errors: ['INVALID_BAG_ID', 'INVALID_RELATIVE_PATH', 'FILE_TOO_LARGE', 'READ_FILE_FAILED'],
})
export const storageShowFileContract = defineRequest({
  ...base,
  channel: STORAGE_CHANNELS.showFile,
  input: z.tuple([BagIdSchema, BagFileNameSchema]),
  output: MutationSchema,
  errors: ['INVALID_BAG_ID', 'INVALID_FILE_NAME', 'PATH_OUTSIDE_DOWNLOAD_DIRECTORY', 'SHOW_FILE_FAILED'],
})
export const storageGetDownloadPathContract = defineRequest({
  ...base,
  channel: STORAGE_CHANNELS.getDownloadPath,
  input: z.tuple([]),
  output: z.object({ success: z.literal(true), path: DownloadPathSchema }),
  errors: ['DOWNLOAD_PATH_READ_FAILED'],
})
export const storageSetDownloadPathContract = defineRequest({
  ...base,
  channel: STORAGE_CHANNELS.setDownloadPath,
  input: z.tuple([DownloadPathSchema]),
  output: MutationSchema,
  errors: ['INVALID_DOWNLOAD_PATH', 'DOWNLOAD_PATH_WRITE_FAILED'],
})
export const storageSelectDownloadFolderContract = defineRequest({
  ...base,
  channel: STORAGE_CHANNELS.selectDownloadFolder,
  input: z.tuple([]),
  output: z.union([
    z.object({ success: z.literal(true), path: DownloadPathSchema }),
    z.object({ success: z.literal(false), canceled: z.literal(true) }),
  ]),
  errors: ['WINDOW_UNAVAILABLE', 'DOWNLOAD_FOLDER_SELECTION_FAILED'],
})
export const storageBagsUpdatedEventContract = defineEvent({
  channel: STORAGE_CHANNELS.bagsUpdated,
  direction: 'event',
  recipient: 'main-renderer',
  payload: z.tuple([z.array(StorageBagSchema)]),
  redaction: 'sensitive',
})
export const storageStatusEventContract = defineEvent({
  channel: STORAGE_CHANNELS.status,
  direction: 'event',
  recipient: 'main-renderer',
  payload: z.tuple([z.object({ running: z.boolean() })]),
  redaction: 'public',
})
export const STORAGE_REQUEST_CONTRACTS = [
  storageAddBagContract,
  storageRemoveBagContract,
  storageListBagsContract,
  storagePauseBagContract,
  storageGetDetailsContract,
  storageOpenFolderContract,
  storageReadFileContract,
  storageShowFileContract,
  storageGetDownloadPathContract,
  storageSetDownloadPathContract,
  storageSelectDownloadFolderContract,
] as const
export const STORAGE_EVENT_CONTRACTS = [storageBagsUpdatedEventContract, storageStatusEventContract] as const
export type StorageBag = z.infer<typeof StorageBagSchema>
export type BagDetails = z.infer<typeof BagDetailsSchema>
