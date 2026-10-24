import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { createSocket } from 'node:dgram'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, cp, access, mkdir, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const visible = process.argv.includes('--visible') && !process.env.CI
const positional = process.argv.slice(2).filter((value) => value !== '--visible')
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
  linux: [new RegExp(`-${arch}\\.AppImage$`), new RegExp(`-${arch}\\.deb$`)],
  win: [/^TON-Browser-Setup-.*\.exe$/, /^TON-Browser-Portable-.*\.exe$/],
}[platform]
if (!patterns) throw new Error('Usage: node scripts/verify-packaged-runtime.mjs [mac|linux|win] [x64|arm64]')
const artifacts = patterns.map((pattern) => {
  const matches = files.filter((file) => pattern.test(file))
  if (matches.length !== 1)
    throw new Error(`Expected exactly one artifact matching ${pattern}; found ${matches.length}`)
  return join(release, matches[0])
})
const scratch = await realpath(await mkdtemp(join(tmpdir(), 'ton-browser-package-smoke-')))
const summary = { version: expectedVersion, platform, arch, visible, ok: false, artifacts: [] }

async function run(command, args, { streamOutput = false, ...options } = {}) {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ASAR
  return new Promise((resolveExit, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'], ...options })
    let output = ''
    const recordOutput = (chunk) => {
      output = (output + chunk.toString()).slice(-20_000)
      if (streamOutput) process.stdout.write(chunk)
    }
    child.stdout.on('data', recordOutput)
    child.stderr.on('data', recordOutput)
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
        killer.on('error', () => child.kill())
      } else child.kill('SIGKILL')
    }, 360_000)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('close', (code, signal) => {
      clearTimeout(timeout)
      if (timedOut) reject(new Error(`${basename(command)} exceeded 360 seconds\n${output}`))
      else if (code === 0) resolveExit()
      else reject(new Error(`${basename(command)} failed (exit ${code}, signal ${signal})\n${output}`))
    })
  })
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

try {
  const url = 'http://manifesto.ton/'
  for (const [index, artifact] of artifacts.entries()) {
    const artifactResult = { artifact: basename(artifact), phases: [], ok: false }
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
    for (const phase of ['live']) {
      const report = join(profile, `${phase}.json`)
      await run(
        executable,
        [
          `--tonnet-package-smoke=${resolve(profile)}`,
          `--tonnet-package-smoke-phase=${phase}`,
          `--tonnet-package-smoke-report=${resolve(report)}`,
          `--tonnet-package-smoke-url=${url}`,
          `--tonnet-package-smoke-version=${expectedVersion}`,
          ...(visible ? ['--tonnet-package-smoke-visible'] : []),
          ...(platform === 'mac' ? ['--use-mock-keychain'] : []),
        ],
        { streamOutput: visible }
      )
      const result = JSON.parse(await readFile(report, 'utf8'))
      if (
        result.ok !== true ||
        result.packaged !== true ||
        result.version !== expectedVersion ||
        result.phase !== phase ||
        !Array.isArray(result.checks) ||
        result.checks.length === 0
      ) {
        throw new Error(`Invalid or unsuccessful ${phase} report: ${JSON.stringify(result)}`)
      }
      artifactResult.phases.push({ phase, checks: result.checks, ok: true })
      if (!visible) for (const check of result.checks) console.log(`  PASS ${phase}: ${check}`)
    }
    artifactResult.ok = true
    console.log(`PASS ${basename(artifact)}: real TON connection, manifesto.ton navigation and clean disconnect`)
  }
  summary.ok = true
} finally {
  await rm(scratch, { recursive: true, force: true })
  const reportDirectory = join(root, '.cache', 'package-smoke')
  await mkdir(reportDirectory, { recursive: true })
  await writeFile(join(reportDirectory, 'latest-report.json'), `${JSON.stringify(summary, null, 2)}\n`)
}
