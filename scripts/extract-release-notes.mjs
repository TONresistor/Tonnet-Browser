#!/usr/bin/env node
// Write the changelog section for package.json's version.
// The Unreleased heading is never included.
import { readFileSync, writeFileSync } from 'node:fs'

const outputPath = process.argv[2] ?? 'release-notes.md'
const version = JSON.parse(readFileSync('package.json', 'utf8')).version
const changelog = readFileSync('CHANGELOG.md', 'utf8')
const header = `## [${version}]`
const start = changelog.indexOf(header)
if (start < 0) {
  console.error(`CHANGELOG.md has no ${header} section`)
  process.exit(1)
}

const rest = changelog.slice(start)
const next = rest.slice(header.length).search(/\n## \[/)
const section = (next === -1 ? rest : rest.slice(0, header.length + next)).trim()
if (section.includes('## [Unreleased]')) {
  console.error('Release notes must not include Unreleased')
  process.exit(1)
}

writeFileSync(outputPath, `${section}\n`)
console.log(`Wrote ${outputPath} for ${version}`)
