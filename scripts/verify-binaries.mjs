#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const configPath = path.join(root, 'scripts', 'binary-versions.json')

function normalizePlatform(value) {
  switch (value) {
    case 'linux':
      return 'linux'
    case 'darwin':
    case 'mac':
      return 'mac'
    case 'win32':
    case 'windows':
    case 'win':
      return 'win'
    default:
      return null
  }
}

const platform = normalizePlatform(process.argv[2] ?? os.platform())
const arch = normalizeArch(process.argv[3] ?? os.arch(), platform)

if (!platform || !arch) {
  console.error('Usage: node scripts/verify-binaries.mjs [linux|mac|win] [x64|arm64]')
  process.exit(1)
}

function normalizeArch(value, targetPlatform) {
  if (targetPlatform === 'mac') return 'universal'

  switch (value) {
    case 'x64':
    case 'amd64':
      return 'x64'
    case 'arm64':
    case 'aarch64':
      return 'arm64'
    default:
      return null
  }
}

function getExpectedElfMachine(targetPlatform, targetArch) {
  if (targetPlatform !== 'linux') return null
  if (targetArch === 'x64') return 0x3e
  if (targetArch === 'arm64') return 0xb7
  return null
}

/** Read only the first `n` bytes of a (possibly >50MB) binary, or null if short. */
function readBytes(binaryPath, n) {
  const buf = Buffer.alloc(n)
  const fd = fs.openSync(binaryPath, 'r')
  let read
  try {
    read = fs.readSync(fd, buf, 0, n, 0)
  } finally {
    fs.closeSync(fd)
  }
  return read >= n ? buf : null
}

function readElfMachine(binaryPath) {
  const header = readBytes(binaryPath, 20)
  if (!header || header[0] !== 0x7f || header[1] !== 0x45 || header[2] !== 0x4c || header[3] !== 0x46) {
    return null
  }
  const dataEncoding = header[5]
  if (dataEncoding === 1) return header.readUInt16LE(18)
  if (dataEncoding === 2) return header.readUInt16BE(18)
  return null
}

/** macOS ships a universal (fat) Mach-O. Assert the fat magic + >= 2 slices. */
function verifyMachoUniversal(binaryPath) {
  const buf = readBytes(binaryPath, 8)
  if (!buf) return 'unreadable'
  const magic = buf.readUInt32BE(0)
  if (magic !== 0xcafebabe && magic !== 0xcafebabf) return `not a universal Mach-O (magic 0x${magic.toString(16)})`
  const slices = buf.readUInt32BE(4)
  if (slices < 2) return `universal Mach-O has ${slices} slice(s), expected >= 2`
  return null
}

/** Assert a Windows PE (MZ + PE header) whose COFF machine matches the target arch. */
function verifyPeMachine(binaryPath, targetArch) {
  const dos = readBytes(binaryPath, 0x40)
  if (!dos || dos[0] !== 0x4d || dos[1] !== 0x5a) return 'not a PE (missing MZ)'
  const peOff = dos.readUInt32LE(0x3c)
  const pe = readBytes(binaryPath, peOff + 6)
  if (!pe || pe[peOff] !== 0x50 || pe[peOff + 1] !== 0x45) return 'not a PE (missing PE signature)'
  const machine = pe.readUInt16LE(peOff + 4)
  const expected = targetArch === 'arm64' ? 0xaa64 : 0x8664
  if (machine !== expected) return `PE machine 0x${machine.toString(16)}, expected 0x${expected.toString(16)}`
  return null
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
const binDir = path.join(root, 'resources', 'bin', platform)
const extension = platform === 'win' ? '.exe' : ''
const missing = []
const notExecutable = []
const wrongArch = []
const wrongSource = []
const expectedElfMachine = getExpectedElfMachine(platform, arch)

for (const binary of config.binaries) {
  const binaryPath = path.join(binDir, `${binary.name}${extension}`)
  const versionPath = path.join(binDir, `.${binary.name}.version`)
  const expectedMarker = `${binary.version}@${binary.commit}/${arch === 'universal' ? 'universal' : arch === 'x64' ? 'amd64' : arch}`

  if (!fs.existsSync(binaryPath)) {
    missing.push(path.relative(root, binaryPath))
    continue
  }

  const actualMarker = fs.existsSync(versionPath) ? fs.readFileSync(versionPath, 'utf8').trim() : '<missing>'
  if (actualMarker !== expectedMarker) {
    wrongSource.push(`${path.relative(root, binaryPath)} marker ${actualMarker}, expected ${expectedMarker}`)
  }

  if (platform !== 'win') {
    const mode = fs.statSync(binaryPath).mode
    if ((mode & 0o111) === 0) {
      notExecutable.push(path.relative(root, binaryPath))
    }
  }

  let archError = null
  if (platform === 'linux' && expectedElfMachine !== null) {
    const elfMachine = readElfMachine(binaryPath)
    if (elfMachine !== expectedElfMachine) archError = `ELF machine: ${elfMachine ?? 'unknown'}`
  } else if (platform === 'mac') {
    archError = verifyMachoUniversal(binaryPath)
  } else if (platform === 'win') {
    archError = verifyPeMachine(binaryPath, arch)
  }
  if (archError) wrongArch.push(`${path.relative(root, binaryPath)} (${archError})`)
}

if (missing.length > 0 || notExecutable.length > 0 || wrongArch.length > 0 || wrongSource.length > 0) {
  if (missing.length > 0) {
    console.error('Missing required binaries:')
    for (const file of missing) console.error(`  - ${file}`)
  }

  if (notExecutable.length > 0) {
    console.error('Required binaries are not executable:')
    for (const file of notExecutable) console.error(`  - ${file}`)
  }

  if (wrongArch.length > 0) {
    console.error(`Required binaries do not match ${platform}/${arch}:`)
    for (const file of wrongArch) console.error(`  - ${file}`)
  }

  if (wrongSource.length > 0) {
    console.error('Required binaries do not match their immutable source pins:')
    for (const file of wrongSource) console.error(`  - ${file}`)
  }

  process.exit(1)
}

console.log(`Verified ${config.binaries.length} binaries in resources/bin/${platform} for ${arch}`)
