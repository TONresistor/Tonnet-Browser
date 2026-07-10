import { describe, expect, it } from 'vitest'
import { BagFileNameSchema, BagIdSchema, RelativeBagPathSchema, storageReadFileContract } from '../storage'

describe('storage IPC contracts', () => {
  const bagId = 'ab'.repeat(32)
  it('requires canonical bag ids', () => {
    expect(BagIdSchema.parse(bagId)).toBe(bagId)
    expect(() => BagIdSchema.parse('abc123')).toThrow()
  })
  it('rejects absolute paths, traversal, separators and null bytes', () => {
    expect(RelativeBagPathSchema.parse('folder/data.csv')).toBe('folder/data.csv')
    for (const value of ['../secret', 'folder/../secret', '/etc/passwd', String.raw`\server\share`, 'a\u0000b']) {
      expect(() => RelativeBagPathSchema.parse(value)).toThrow()
    }
    for (const value of ['../file', 'folder/file', String.raw`folder\file`, 'a\u0000b']) {
      expect(() => BagFileNameSchema.parse(value)).toThrow()
    }
    expect(storageReadFileContract.input.parse([bagId, 'data.csv'])).toHaveLength(2)
  })
})
