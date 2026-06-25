#!/usr/bin/env node
// Guards against the cross-platform lockfile trap.
//
// A Linux-only `npm install` (or a Dependabot/CI regen) silently strips the
// macOS/Windows native binaries of rollup/esbuild from package-lock.json.
// `npm ci` on Linux still passes, so it slips through the validate job — but the
// mac/win release builds (which only run at tag time) then fail to resolve
// `@rollup/rollup-darwin-arm64` & co, breaking the release after the fact.
//
// Running this on every PR makes the trap fail at the gate, not at release time.
// Fix: rm -rf node_modules package-lock.json && npm install   (then commit the lockfile)
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const lockPath = path.join(root, 'package-lock.json')

// Native optional deps required by the release matrix: linux x64/arm64, win x64, mac universal.
const requiredNatives = [
  '@rollup/rollup-linux-x64-gnu',
  '@rollup/rollup-linux-arm64-gnu',
  '@rollup/rollup-win32-x64-msvc',
  '@rollup/rollup-darwin-x64',
  '@rollup/rollup-darwin-arm64',
  '@esbuild/linux-x64',
  '@esbuild/linux-arm64',
  '@esbuild/win32-x64',
  '@esbuild/darwin-x64',
  '@esbuild/darwin-arm64',
]

const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
const packages = lock.packages ?? {}
const missing = requiredNatives.filter((name) => !(`node_modules/${name}` in packages))

if (missing.length > 0) {
  console.error('package-lock.json is missing cross-platform native binaries:')
  for (const name of missing) console.error(`  - ${name}`)
  console.error('')
  console.error('This breaks the macOS/Windows release builds (they cannot resolve these natives).')
  console.error('It usually means the lockfile was regenerated on Linux only.')
  console.error('Fix: rm -rf node_modules package-lock.json && npm install   (then commit package-lock.json)')
  process.exit(1)
}

console.log(`Verified ${requiredNatives.length} cross-platform native binaries in package-lock.json`)
