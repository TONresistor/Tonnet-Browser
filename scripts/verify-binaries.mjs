#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(new URL('..', import.meta.url).pathname)
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

function readElfMachine(binaryPath) {
  const header = fs.readFileSync(binaryPath).subarray(0, 20)
  if (header.length < 20 || header[0] !== 0x7f || header[1] !== 0x45 || header[2] !== 0x4c || header[3] !== 0x46) {
    return null
  }

  const dataEncoding = header[5]
  if (dataEncoding === 1) return header.readUInt16LE(18)
  if (dataEncoding === 2) return header.readUInt16BE(18)
  return null
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
const binDir = path.join(root, 'resources', 'bin', platform)
const extension = platform === 'win' ? '.exe' : ''
const missing = []
const notExecutable = []
const wrongArch = []
const expectedElfMachine = getExpectedElfMachine(platform, arch)

for (const binary of config.binaries) {
  const binaryPath = path.join(binDir, `${binary.name}${extension}`)

  if (!fs.existsSync(binaryPath)) {
    missing.push(path.relative(root, binaryPath))
    continue
  }

  if (platform !== 'win') {
    const mode = fs.statSync(binaryPath).mode
    if ((mode & 0o111) === 0) {
      notExecutable.push(path.relative(root, binaryPath))
    }
  }

  if (expectedElfMachine !== null) {
    const elfMachine = readElfMachine(binaryPath)
    if (elfMachine !== expectedElfMachine) {
      wrongArch.push(`${path.relative(root, binaryPath)} (ELF machine: ${elfMachine ?? 'unknown'})`)
    }
  }
}

if (missing.length > 0 || notExecutable.length > 0 || wrongArch.length > 0) {
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

  process.exit(1)
}

console.log(`Verified ${config.binaries.length} binaries in resources/bin/${platform} for ${arch}`)
