import { createReadStream } from 'node:fs'
import { runPackageTestProcess as run } from './run-package-test-process.mjs'
import { createServer } from 'node:net'
import { createSocket } from 'node:dgram'
import { generateKeyPairSync, createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, cp, access, mkdir, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const visible = process.argv.includes('--visible') && !process.env.CI
const suite = process.argv.find((arg) => arg.startsWith('--suite='))?.slice('--suite='.length) ?? 'smoke'
const contract = JSON.parse(await readFile(join(root, 'src/shared/packaged-test-contract.json'), 'utf8'))
if (!Object.hasOwn(contract.suites, suite)) throw new Error(`Unknown test suite: ${suite}`)
const positional = process.argv.slice(2).filter((value) => value !== '--visible' && !value.startsWith('--suite='))
const platform = positional[0] ?? { darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform]
const arch = positional[1] ?? process.arch
const host = { mac: 'darwin', win: 'win32', linux: 'linux' }[platform]
if (host !== process.platform || arch !== process.arch) {
  throw new Error(
    `Package smoke requires a native ${platform}/${arch} runner; current host is ${process.platform}/${process.arch}`
  )
}
const expectedVersion = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version
const release = join(root, 'release')
const files = await readdir(release)
const patterns = {
  mac: [/\.dmg$/],
  linux: [
    new RegExp(`-${arch === 'x64' ? 'x86_64' : arch}\\.AppImage$`),
    new RegExp(`-${arch === 'x64' ? 'amd64' : arch}\\.deb$`),
  ],
  win: [/^TON-Browser-Setup-.*\.exe$/, /^TON-Browser-Portable-.*\.exe$/],
}[platform]
if (!patterns) throw new Error('Usage: node scripts/verify-packaged-runtime.mjs [mac|linux|win] [x64|arm64]')
// Every format gets the release smoke; deeper suites use one package per runner.
const artifacts = (suite === 'smoke' ? patterns : patterns.slice(0, 1)).map((pattern) => {
  const matches = files.filter((file) => pattern.test(file))
  if (matches.length !== 1)
    throw new Error(`Expected exactly one artifact matching ${pattern}; found ${matches.length}`)
  return join(release, matches[0])
})
const scratch = await realpath(await mkdtemp(join(tmpdir(), 'ton-browser-package-smoke-')))
const runId = randomUUID()
const startedAt = Date.now()
const summary = {
  runId,
  suite,
  scenario: contract.scenario,
  startedAt: new Date(startedAt).toISOString(),
  version: expectedVersion,
  platform,
  arch,
  visible,
  ok: false,
  artifacts: [],
}

async function findFile(directory, predicate) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name)
    if (predicate(entry)) return full
    if (entry.isDirectory()) {
      const found = await findFile(full, predicate)
      if (found) return found
    }
  }
  return undefined
}

async function executableFromArtifact(artifact, directory) {
  if (platform === 'mac') {
    const mount = join(directory, 'mount')
    await run('hdiutil', ['attach', artifact, '-nobrowse', '-readonly', '-mountpoint', mount])
    try {
      const app = await findFile(mount, (entry) => entry.isDirectory() && entry.name.endsWith('.app'))
      if (!app) throw new Error('DMG contains no application bundle')
      const copy = join(directory, basename(app))
      await cp(app, copy, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true })
      const executable = join(copy, 'Contents', 'MacOS', 'TON Browser')
      await access(executable)
      return executable
    } finally {
      await run('hdiutil', ['detach', mount])
    }
  }
  if (artifact.endsWith('.AppImage')) {
    await run(artifact, ['--appimage-extract'], { cwd: directory })
    return join(directory, 'squashfs-root', 'AppRun')
  }
  if (artifact.endsWith('.deb')) {
    await run('dpkg-deb', ['--extract', artifact, directory])
    const executable = await findFile(join(directory, 'opt'), (entry) => entry.isFile() && entry.name === 'ton-browser')
    if (!executable) throw new Error('deb contains no ton-browser executable')
    return executable
  }
  if (basename(artifact).includes('-Portable-')) return artifact
  // Extract NSIS payload without installing shortcuts or changing the user's registry.
  const sevenZip = 'C:\\Program Files\\7-Zip\\7z.exe'
  await run(sevenZip, ['x', artifact, `-o${directory}`, '-y'])
  const payload = await findFile(directory, (entry) => entry.isFile() && /^app-.*\.7z$/.test(entry.name))
  if (!payload) throw new Error('NSIS installer contains no application archive')
  const unpacked = join(directory, 'application')
  await run(sevenZip, ['x', payload, `-o${unpacked}`, '-y'])
  const executable = await findFile(unpacked, (entry) => entry.isFile() && entry.name === 'TON Browser.exe')
  if (!executable) throw new Error('NSIS application archive contains no TON Browser.exe')
  return executable
}

async function artifactDigest(path) {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  return digest.digest('hex')
}

try {
  const url = 'http://manifesto.ton/'
  for (const [index, artifact] of artifacts.entries()) {
    const artifactResult = {
      artifact: basename(artifact),
      sha256: await artifactDigest(artifact),
      phases: [],
      ok: false,
    }
    summary.artifacts.push(artifactResult)
    const directory = await mkdtemp(join(scratch, `artifact-${index}-`))
    const executable = await executableFromArtifact(artifact, directory)
    const profile = join(directory, 'profile')
    await mkdir(profile)
    await writeFile(join(profile, '.tonnet-package-smoke'), '')
    console.log(`\nPackage smoke: ${basename(artifact)}`)
    const reservations = Array.from({ length: 3 }, () => createServer())
    const ports = await Promise.all(
      reservations.map(
        (server) =>
          new Promise((resolvePort, reject) => {
            server.once('error', reject)
            server.listen(0, '127.0.0.1', () => resolvePort(server.address().port))
          })
      )
    )
    await writeFile(
      join(profile, 'app-settings.json'),
      JSON.stringify({
        schemaVersion: 4,
        privacy: { clearOnExit: true },
        network: { proxyPort: ports[0], wsPort: ports[1], storagePort: ports[2], autoConnect: false },
      })
    )
    await Promise.all(reservations.map((server) => new Promise((resolveClose) => server.close(resolveClose))))
    // Storage's HTTP port is configurable independently of its ADNL UDP port.
    // Seed only this disposable node config so an existing browser keeps its port.
    const udp = createSocket('udp4')
    const udpPort = await new Promise((resolvePort, reject) => {
      udp.once('error', reject)
      udp.bind(0, () => resolvePort(udp.address().port))
    })
    const keyPair = generateKeyPairSync('ed25519')
    const seed = keyPair.privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32)
    const publicKey = keyPair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)
    const storageDb = join(profile, 'storage', 'db')
    await mkdir(storageDb, { recursive: true })
    await writeFile(
      join(storageDb, 'config.json'),
      JSON.stringify({
        Version: 0,
        Key: Buffer.concat([seed, publicKey]).toString('base64'),
        ListenAddr: `0.0.0.0:${udpPort}`,
        ExternalIP: '',
        DownloadsPath: join(profile, 'storage'),
        NetworkConfigUrl: 'https://ton-blockchain.github.io/global.config.json',
      }),
      { mode: 0o600 }
    )
    await new Promise((resolveClose) => udp.close(resolveClose))
    for (const phase of contract.suites[suite]) {
      const report = join(profile, `package-test-${phase}.json`)
      const phaseStartedAt = Date.now()
      try {
        await run(
          executable,
          [
            `--tonnet-package-smoke=${resolve(profile)}`,
            `--tonnet-package-smoke-phase=${phase}`,
            `--tonnet-package-smoke-suite=${suite}`,
            `--tonnet-package-smoke-report=${resolve(report)}`,
            `--tonnet-package-smoke-url=${url}`,
            `--tonnet-package-smoke-version=${expectedVersion}`,
            ...(visible ? ['--tonnet-package-smoke-visible'] : []),
            ...(platform === 'mac' ? ['--use-mock-keychain'] : []),
          ],
          { streamOutput: true }
        )
      } catch (error) {
        const diagnostics = join(root, '.cache', 'package-smoke', runId, basename(artifact))
        await mkdir(diagnostics, { recursive: true })
        await writeFile(join(diagnostics, `${phase}-output.txt`), error.message)
        for (const name of await readdir(profile)) {
          if (contract.suites[suite].some((p) => name === `package-test-${p}.json` || name === `${p}-failure.png`)) {
            await cp(join(profile, name), join(diagnostics, name))
          }
        }
        artifactResult.phases.push({ phase, ok: false, durationMs: Date.now() - phaseStartedAt })
        summary.diagnostics = `${runId}/${basename(artifact)}`
        throw error
      }
      const result = JSON.parse(await readFile(report, 'utf8'))
      if (
        result.scenario !== contract.scenario ||
        result.suite !== suite ||
        result.ok !== true ||
        result.packaged !== true ||
        result.version !== expectedVersion ||
        result.phase !== phase ||
        !Array.isArray(result.checks) ||
        result.checks.length === 0
      ) {
        throw new Error(`Invalid or unsuccessful ${phase} report: ${JSON.stringify(result)}`)
      }
      artifactResult.phases.push({
        phase,
        checks: result.checks,
        internalRoutes: result.internalRoutes,
        durationMs: Date.now() - phaseStartedAt,
        ok: true,
      })
    }
    artifactResult.ok = true
    console.log(`PASS ${basename(artifact)}: ${suite} suite and real process restart validation`)
  }
  summary.ok = true
} catch (error) {
  summary.error = error.message
  throw error
} finally {
  await rm(scratch, { recursive: true, force: true })
  const reportDirectory = join(root, '.cache', 'package-smoke')
  await mkdir(reportDirectory, { recursive: true })
  summary.durationMs = Date.now() - startedAt
  await writeFile(join(reportDirectory, `latest-${suite}-report.json`), `${JSON.stringify(summary, null, 2)}\n`)
  await writeFile(join(reportDirectory, 'latest-report.json'), `${JSON.stringify(summary, null, 2)}\n`)
}
