import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { writeJsonAtomic, writeSecureJsonAtomic } from '../secure-fs'

const isPosix = process.platform !== 'win32'

describe('writeJsonAtomic', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secure-fs-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('writes JSON content with 2-space indent by default', () => {
    const target = path.join(tmpDir, 'data.json')
    writeJsonAtomic(target, { a: 1, b: { c: 2 } })
    expect(fs.readFileSync(target, 'utf-8')).toBe('{\n  "a": 1,\n  "b": {\n    "c": 2\n  }\n}')
  })

  it('honors tab indent', () => {
    const target = path.join(tmpDir, 'data.json')
    writeJsonAtomic(target, { a: 1 }, '\t')
    expect(fs.readFileSync(target, 'utf-8')).toBe('{\n\t"a": 1\n}')
  })

  it('creates parent directory if missing', () => {
    const target = path.join(tmpDir, 'nested', 'deep', 'data.json')
    writeJsonAtomic(target, { ok: true })
    expect(fs.existsSync(target)).toBe(true)
  })

  it('leaves no tmp file on success', () => {
    const target = path.join(tmpDir, 'data.json')
    writeJsonAtomic(target, { ok: true })
    expect(fs.existsSync(`${target}.tmp`)).toBe(false)
  })

  it('cleans up tmp on write failure', () => {
    const target = path.join(tmpDir, 'data.json')
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => writeJsonAtomic(target, cyclic)).toThrow()
    expect(fs.existsSync(`${target}.tmp`)).toBe(false)
    expect(fs.existsSync(target)).toBe(false)
  })

  it.skipIf(!isPosix)('respects default umask when no mode is given', () => {
    const target = path.join(tmpDir, 'data.json')
    writeJsonAtomic(target, { ok: true })
    const mode = fs.statSync(target).mode & 0o777
    expect(mode & 0o600).toBe(0o600)
  })
})

describe('writeSecureJsonAtomic', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secure-fs-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('writes JSON content with tab indent by default', () => {
    const target = path.join(tmpDir, 'config.json')
    writeSecureJsonAtomic(target, { a: 1, b: { c: 2 } })
    const content = fs.readFileSync(target, 'utf-8')
    expect(JSON.parse(content)).toEqual({ a: 1, b: { c: 2 } })
    expect(content).toContain('\t')
  })

  it('honors custom indent', () => {
    const target = path.join(tmpDir, 'config.json')
    writeSecureJsonAtomic(target, { a: 1 }, 2)
    expect(fs.readFileSync(target, 'utf-8')).toBe('{\n  "a": 1\n}')
  })

  it.skipIf(!isPosix)('sets file mode to 0o600 on POSIX', () => {
    const target = path.join(tmpDir, 'config.json')
    writeSecureJsonAtomic(target, { secret: 'value' })
    expect(fs.statSync(target).mode & 0o777).toBe(0o600)
  })

  it.skipIf(!isPosix)('overwrites existing 0o644 file with 0o600', () => {
    const target = path.join(tmpDir, 'config.json')
    fs.writeFileSync(target, '{}', { mode: 0o644 })
    expect(fs.statSync(target).mode & 0o777).toBe(0o644)

    writeSecureJsonAtomic(target, { new: true })
    expect(fs.statSync(target).mode & 0o777).toBe(0o600)
  })

  it('creates parent directory if missing', () => {
    const target = path.join(tmpDir, 'nested', 'deep', 'config.json')
    writeSecureJsonAtomic(target, { ok: true })
    expect(fs.existsSync(target)).toBe(true)
  })

  it('leaves no tmp file on success', () => {
    const target = path.join(tmpDir, 'config.json')
    writeSecureJsonAtomic(target, { ok: true })
    expect(fs.existsSync(`${target}.tmp`)).toBe(false)
  })

  it('cleans up tmp on write failure', () => {
    const target = path.join(tmpDir, 'config.json')
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => writeSecureJsonAtomic(target, cyclic)).toThrow()
    expect(fs.existsSync(`${target}.tmp`)).toBe(false)
  })
})
