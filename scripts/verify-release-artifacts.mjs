#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const releaseDir = path.join(root, 'release')

const platform = process.argv[2]
const arch = normalizeArch(process.argv[3])

function normalizeArch(value) {
  switch (value) {
    case undefined:
    case '':
      return null
    case 'x64':
    case 'amd64':
      return 'x64'
    case 'arm64':
    case 'aarch64':
      return 'arm64'
    default:
      return value
  }
}

const linuxArtifactSuffixes = getLinuxArtifactSuffixes(arch)

function getLinuxArtifactSuffixes(value) {
  if (!value) return ['']
  if (value === 'x64') return ['-x64', '-amd64', '-x86_64']
  if (value === 'arm64') return ['-arm64', '-aarch64']
  return [`-${value}`]
}

function hasLinuxArtifactSuffix(file, extension) {
  return linuxArtifactSuffixes.some((suffix) => file.endsWith(`${suffix}.${extension}`))
}

const linuxArtifactLabelSuffix = arch ? `-${arch}` : ''
const linuxExpectations = [
  { label: `Linux${linuxArtifactLabelSuffix} AppImage`, test: (file) => hasLinuxArtifactSuffix(file, 'AppImage') },
  { label: `Linux${linuxArtifactLabelSuffix} deb package`, test: (file) => hasLinuxArtifactSuffix(file, 'deb') },
]

if (!arch || arch === 'x64') {
  linuxExpectations.push({ label: 'Linux update metadata', test: (file) => file === 'latest-linux.yml' })
} else if (arch === 'arm64') {
  linuxExpectations.push({ label: 'Linux ARM64 update metadata', test: (file) => file === 'latest-linux-arm64.yml' })
}

const expectations = {
  linux: linuxExpectations,
  win: [
    { label: 'Windows installer', test: (file) => /^TON-Browser-Setup-.*\.exe$/.test(file) },
    { label: 'Windows portable executable', test: (file) => /^TON-Browser-Portable-.*\.exe$/.test(file) },
    { label: 'Windows update metadata', test: (file) => file === 'latest.yml' },
  ],
  mac: [
    { label: 'macOS DMG', test: (file) => file.endsWith('.dmg') },
    { label: 'macOS update metadata', test: (file) => file === 'latest-mac.yml' },
  ],
}

if (!Object.hasOwn(expectations, platform)) {
  console.error('Usage: node scripts/verify-release-artifacts.mjs [linux|mac|win] [x64|arm64]')
  process.exit(1)
}

if (!fs.existsSync(releaseDir)) {
  console.error('Missing release directory')
  process.exit(1)
}

const files = fs.readdirSync(releaseDir)
const missing = expectations[platform].filter((expectation) => !files.some(expectation.test))

if (missing.length > 0) {
  console.error(`Missing expected ${platform} release artifacts:`)
  for (const expectation of missing) console.error(`  - ${expectation.label}`)
  console.error(`Files found in release/: ${files.length > 0 ? files.join(', ') : '(none)'}`)
  process.exit(1)
}

console.log(`Verified ${platform} release artifacts`)
