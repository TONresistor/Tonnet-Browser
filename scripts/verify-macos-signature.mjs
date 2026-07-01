#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const releaseDir = path.join(root, 'release')

if (process.platform !== 'darwin') {
  console.log('verify-macos-signature: not macOS, skipping')
  process.exit(0)
}

if (!fs.existsSync(releaseDir)) {
  console.error('verify-macos-signature: missing release/ directory')
  process.exit(1)
}

function findApps(dir) {
  const found = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const full = path.join(dir, entry.name)
    if (entry.name.endsWith('.app')) {
      found.push(full)
      continue
    }
    if (/^mac/.test(entry.name) && !/temp/i.test(entry.name)) found.push(...findApps(full))
  }
  return found
}

const apps = findApps(releaseDir)
if (apps.length === 0) {
  console.error('verify-macos-signature: no .app bundle found under release/')
  console.error(`Contents: ${fs.readdirSync(releaseDir).join(', ') || '(empty)'}`)
  process.exit(1)
}

let failed = false
for (const app of apps) {
  const rel = path.relative(root, app)
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], {
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    const probe = spawnSync('codesign', ['-dvv', app], { encoding: 'utf8' })
    const info = `${probe.stdout || ''}${probe.stderr || ''}`
    const adhoc = /Signature=adhoc/.test(info)
    console.log(`verify-macos-signature: OK ${rel}${adhoc ? ' (ad-hoc)' : ''}`)
  } catch {
    console.error(`verify-macos-signature: codesign verification FAILED for ${rel}`)
    failed = true
  }
}

if (failed) {
  console.error('verify-macos-signature: at least one bundle failed signature verification')
  process.exit(1)
}

console.log(`verify-macos-signature: verified ${apps.length} bundle(s)`)
