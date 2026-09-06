import { readFile } from 'node:fs/promises'

const [pkg, lock, binaries] = await Promise.all([
  readFile('package.json', 'utf8').then(JSON.parse),
  readFile('package-lock.json', 'utf8').then(JSON.parse),
  readFile('scripts/binary-versions.json', 'utf8').then(JSON.parse),
])

const failures = []
if (lock.version !== pkg.version)
  failures.push(`package-lock.json version ${lock.version} != package.json ${pkg.version}`)
if (lock.packages?.['']?.version !== pkg.version) {
  failures.push(
    `package-lock root version ${lock.packages?.['']?.version ?? '<missing>'} != package.json ${pkg.version}`
  )
}

if (!/^\d+\.\d+(?:\.\d+)?$/.test(binaries.go_version ?? ''))
  failures.push('binary-versions.json go_version must be major.minor or major.minor.patch')
if (!Array.isArray(binaries.binaries) || binaries.binaries.length === 0) failures.push('binary list must not be empty')
for (const helper of binaries.binaries ?? []) {
  const name = helper.name ?? '<unnamed>'
  if (!/^v\d+\.\d+\.\d+(?:[-+].+)?$/.test(helper.version ?? '')) failures.push(`${name} has an invalid pinned version`)
  if (!/^[a-f0-9]{40}$/.test(helper.commit ?? ''))
    failures.push(`${name} must declare an immutable 40-character commit pin`)
  if (!/^[\w.-]+\/[\w.-]+$/.test(helper.repo ?? '')) failures.push(`${name} must use an owner/repository source`)
  if (typeof helper.entry_point !== 'string' || helper.entry_point.length === 0) {
    failures.push(`${name} must declare an entry point`)
  }
}

if (failures.length > 0) {
  console.error(`Release metadata verification failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`)
  process.exit(1)
}

console.log(`Release metadata verified for ${pkg.name}@${pkg.version} and ${binaries.binaries.length} helpers.`)
