import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'

const output = process.argv[2] ?? 'build-provenance.json'
const [packageSource, lockSource, binarySource] = await Promise.all([
  readFile('package.json', 'utf8'),
  readFile('package-lock.json'),
  readFile('scripts/binary-versions.json', 'utf8'),
])
const pkg = JSON.parse(packageSource)
const binaries = JSON.parse(binarySource)

function git(...args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

const provenance = {
  schemaVersion: 1,
  subject: {
    name: pkg.name,
    version: pkg.version,
  },
  source: {
    repository: pkg.repository?.url ?? git('config', '--get', 'remote.origin.url'),
    commit: process.env.GITHUB_SHA ?? git('rev-parse', 'HEAD'),
    ref: process.env.GITHUB_REF ?? git('symbolic-ref', '--short', '-q', 'HEAD'),
    dirty: git('status', '--porcelain') ? true : false,
  },
  build: {
    runId: process.env.GITHUB_RUN_ID ?? null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    workflow: process.env.GITHUB_WORKFLOW ?? null,
    runnerOs: process.env.RUNNER_OS ?? process.platform,
    runnerArch: process.env.RUNNER_ARCH ?? process.arch,
    node: process.version,
  },
  materials: {
    packageLockSha256: createHash('sha256').update(lockSource).digest('hex'),
    nativeHelpers: binaries,
  },
  generatedAt: new Date().toISOString(),
}

await writeFile(output, `${JSON.stringify(provenance, null, 2)}\n`, { mode: 0o644 })
console.log(`Wrote build provenance to ${output}`)
