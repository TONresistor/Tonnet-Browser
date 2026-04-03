# Architecture: Startup Optimization

## Overview
Cinq changements dans la sequence de demarrage: (1) cleanup des process enfants avant retry, (2) defer du bridge apres readiness proxy pour eliminer la contention DHT, (3) parallelisation storage/proxy, (4) fail-fast du storage sur crash, (5) elimination des imports dynamiques redondants. Aucune nouvelle abstraction, aucun nouveau fichier.

## Chronologie actuelle (problematique)

```
t=0s    app.whenReady()
        |-- createServices()
        |-- registerIpcHandlers()
        |-- createWindow()
t=5s    ready-to-show
        |-- startProxySequence()
            |-- proxyManager.start()
                |-- startOnce() [ATTEMPT 1]
                    |-- spawn proxy + bridge
                    |-- bridge ready (port 8081) .............. t=6s
                    |-- waitForReady() ........................ TIMEOUT (DHT fail)
                    |-- proxy exit code 1 .................... t=18s
                |-- this.process = null
                |-- this.bridgeProcess = null  <-- BUG: bridge pas tue
                |-- wait 2000ms
                |-- startOnce() [ATTEMPT 2]
                    |-- spawn proxy + bridge  <-- bridge crash: port 8081 deja pris
                    |-- waitForReady() ........................ OK cette fois
                    |-- proxy ready .......................... t=35s
            |-- storageManager.start()  <-- SEQUENTIEL: attend proxy
                |-- spawn storage
                |-- ping API until ready .................. t=36s
```

## Chronologie cible

```
t=0s    app.whenReady()
        |-- createServices()
        |-- registerIpcHandlers()
        |-- createWindow()
t=5s    ready-to-show
        |-- startProxySequence()
            |-- [PARALLEL]
            |   |-- proxyManager.start()
            |   |   |-- startOnce()
            |   |   |   |-- spawn proxy SEUL (pas de bridge)
            |   |   |   |-- DHT discovery .................. pas de contention
            |   |   |   |-- tunnel ready ................... t=20s (vs 35s avant)
            |   |   |-- startBridge() ...................... apres proxy ready
            |   |   |   |-- spawn bridge
            |   |   |   |-- bridge ready ................... t=21s
            |   |   |   |-- emit 'ws-bridge-ready'
            |   |
            |   |-- storageManager.start()  <-- PARALLEL: demarre en meme temps
            |       |-- spawn storage
            |       |-- ping API (fail-fast si crash)
            |       |-- storage ready ...................... t=6s (deja fini)
            |
            |-- initTabManager()  <-- attend seulement le proxy
```

**Gain estime: ~15s** en eliminant le retry cause par la contention DHT. Le proxy n'a plus besoin de retry si le DHT a le reseau pour lui seul.

## Composants modifies

### 1. ProxyManager.start() -- cleanup avant retry

**Fichier:** `src/main/proxy/manager.ts`
**Modification:** Ajouter une methode privee `stopRunningProcesses()` et l'appeler dans la boucle retry avant de relancer `startOnce()`.

```typescript
// AVANT (bugge)
async start(): Promise<void> {
  for (let attempt = 1; attempt <= ProxyManager.MAX_START_RETRIES; attempt++) {
    try {
      await this.startOnce()
      return
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (attempt < ProxyManager.MAX_START_RETRIES && message.includes('exited before ready')) {
        log.warn(`Proxy start failed (attempt ${attempt}/...): ${message}`)
        log.info(`Retrying in ${ProxyManager.RETRY_DELAY_MS}ms...`)
        this.process = null        // BUG: process pas tue
        this.bridgeProcess = null  // BUG: bridge pas tue
        await new Promise((r) => setTimeout(r, ProxyManager.RETRY_DELAY_MS))
      } else {
        throw err
      }
    }
  }
}

// APRES (corrige)
async start(): Promise<void> {
  for (let attempt = 1; attempt <= ProxyManager.MAX_START_RETRIES; attempt++) {
    try {
      await this.startOnce()
      return
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (attempt < ProxyManager.MAX_START_RETRIES && message.includes('exited before ready')) {
        log.warn(`Proxy start failed (attempt ${attempt}/...): ${message}`)
        await this.stopRunningProcesses()
        log.info(`Retrying in ${ProxyManager.RETRY_DELAY_MS}ms...`)
        await new Promise((r) => setTimeout(r, ProxyManager.RETRY_DELAY_MS))
      } else {
        throw err
      }
    }
  }
}

private async stopRunningProcesses(): Promise<void> {
  // Reutilise la logique existante de stop() mais sans emettre 'disconnected'
  const killProcess = (proc: ChildProcess): Promise<void> => {
    return new Promise((resolve) => {
      proc.stdout?.removeAllListeners()
      proc.stderr?.removeAllListeners()
      proc.removeAllListeners()
      const forceKill = setTimeout(() => {
        try { proc.kill('SIGKILL') } catch { /* dead */ }
        resolve()
      }, 5000)
      proc.once('exit', () => { clearTimeout(forceKill); resolve() })
      proc.kill('SIGTERM')
    })
  }

  const promises: Promise<void>[] = []
  if (this.bridgeProcess) {
    promises.push(killProcess(this.bridgeProcess))
    this.bridgeProcess = null
  }
  if (this.process) {
    promises.push(killProcess(this.process))
    this.process = null
  }
  await Promise.allSettled(promises)
}
```

**Pourquoi une methode separee plutot que `stop()`:** `stop()` emet `disconnected` et remet le status a `stopped`, ce qui pourrait declencher des effets de bord dans les listeners (UI, reconnexion). `stopRunningProcesses()` fait le cleanup silencieusement.

### 2. ProxyManager.startOnce() -- defer bridge apres proxy ready

**Fichier:** `src/main/proxy/manager.ts`
**Modification:** Sortir le spawn du bridge de `startOnce()`. Le proxy demarre seul. Le bridge est lance apres `waitForReady()`, quand le proxy est connecte et n'a plus besoin du reseau pour le DHT.

```typescript
// AVANT: proxy et bridge lances en meme temps
private async startOnce(): Promise<void> {
  // ... config, spawn proxy ...
  this.process = spawn(proxyBinPath, [...], { windowsHide: true, cwd: proxyWorkDir })

  // Bridge lance immediatement apres -- contention reseau
  this.bridgeProcess = spawn(bridgeBinPath, bridgeArgs, { windowsHide: true })

  // ... handlers ...
  await this.waitForReady()  // attend le proxy, bridge fait du DHT en parallele
  this.setStatus('connected')
}

// APRES: bridge differe apres readiness proxy
private async startOnce(): Promise<void> {
  // ... config, spawn proxy SEUL ...
  this.process = spawn(proxyBinPath, [...], { windowsHide: true, cwd: proxyWorkDir })

  // Handlers proxy uniquement
  this.process.stdout?.on('data', handleProxyOutput)
  this.process.stderr?.on('data', handleProxyOutput)
  this.process.on('exit', ...)
  this.process.on('error', ...)

  await this.waitForReady()  // proxy a le reseau pour lui seul
  this.setStatus('connected')

  // Bridge lance APRES le proxy: plus de contention DHT
  await this.startBridge()
}

private async startBridge(): Promise<void> {
  const bridgeBinPath = getBinaryPath('tonutils-bridge')
  const bridgeWorkDir = this.getBridgeWorkDir()
  const bridgeArgs = ['-addr', `127.0.0.1:${this.wsPort}`, '-data-dir', bridgeWorkDir, '-verbosity', '2']

  log.info(`Starting bridge from: ${bridgeBinPath}`)
  log.info(`Bridge WS port: ${this.wsPort}`)

  this.bridgeProcess = spawn(bridgeBinPath, bridgeArgs, { windowsHide: true })

  this.bridgeProcess.stdout?.on('data', this.handleBridgeOutput.bind(this))
  this.bridgeProcess.stderr?.on('data', this.handleBridgeOutput.bind(this))
  this.bridgeProcess.on('exit', (code) => {
    log.info(`Bridge exited with code: ${code}`)
    this.bridgeProcess = null
    this.emit('exit', code)
  })
  this.bridgeProcess.on('error', (err) => {
    log.error(`Failed to start bridge:`, err)
    this.emit('error', err.message)
  })
}
```

**Pourquoi:** Le bridge fait son propre bootstrap DHT (liteserver pool, DHT client, DNS resolver). En le lancant en meme temps que le proxy, les deux se disputent les memes sockets UDP et bootstrap nodes. Le proxy perd la course car la tunnel relay discovery est plus lourde que les requetes liteserver du bridge. En differant le bridge, le proxy a le reseau entier au premier essai.

**Impact sur le wallet:** L'event `ws-bridge-ready` arrive ~1s apres le spawn du bridge (temps d'init DHT du bridge). Le wallet attendait deja cet event via le listener `once('ws-bridge-ready')` dans index.ts. Aucun changement cote wallet.

**Impact sur le retry:** `stopRunningProcesses()` reste inchange: il tue le proxy (et le bridge s'il existe). Si le proxy echoue avant d'etre ready, le bridge n'a pas encore ete lance, donc pas de process orphelin.

### 3. startProxySequence() -- paralleliser storage

**Fichier:** `src/main/proxy/startup.ts`
**Modification:** Lancer `storageManager.start()` en parallele avec `proxyManager.start()`, pas en serie apres.

```typescript
// AVANT
export async function startProxySequence(...): Promise<void> {
  sendProgress(0, 'Starting proxy...')
  // ... log listener setup ...
  await proxyManager.start()              // attend proxy (20-35s)
  proxyManager.off('log', logListener)
  if (mainWindow) {
    initTabManager(mainWindow, proxyManager.getStatus().port, tabDeps)
  }
  try {
    await storageManager.start()          // attend storage APRES proxy
    log.info('Storage daemon started')
  } catch (storageError) {
    log.error(`Failed to start storage: ${String(storageError)}`)
  }
  sendProgress(4, 'Ready!')
}

// APRES
export async function startProxySequence(...): Promise<void> {
  sendProgress(0, 'Starting proxy...')
  // ... log listener setup ...

  // Storage n'a aucune dependance sur le proxy: lancer en parallele
  const storagePromise = storageManager.start()
    .then(() => log.info('Storage daemon started'))
    .catch((err) => log.error(`Failed to start storage: ${String(err)}`))

  await proxyManager.start()
  proxyManager.off('log', logListener)

  if (mainWindow) {
    initTabManager(mainWindow, proxyManager.getStatus().port, tabDeps)
  }

  // Attendre que le storage finisse aussi (probablement deja fini)
  await storagePromise

  sendProgress(4, 'Ready!')
}
```

### 3. StorageManager.waitForReady() -- fail-fast sur crash

**Fichier:** `src/main/storage/daemon.ts`
**Modification:** Ecouter l'event `exit` du process dans `waitForReady()` pour detecter un crash immediat au lieu d'attendre 15s de ping timeout.

```typescript
// AVANT: poll aveugle pendant 15s max
private async waitForReady(): Promise<void> {
  for (let i = 0; i < PING_MAX_ATTEMPTS; i++) {
    try {
      await this.client.ping()
      return
    } catch {
      await new Promise(r => setTimeout(r, PING_RETRY_DELAY_MS))
    }
  }
  throw new Error('Storage daemon not ready')
}

// APRES: fail-fast si le process meurt
private async waitForReady(): Promise<void> {
  return new Promise((resolve, reject) => {
    let resolved = false
    const onExit = (code: number | null) => {
      if (!resolved) {
        resolved = true
        reject(new Error(`Storage daemon exited before ready (code: ${code})`))
      }
    }
    this.process!.once('exit', onExit)

    const poll = async () => {
      for (let i = 0; i < PING_MAX_ATTEMPTS; i++) {
        if (resolved) return
        try {
          await this.client.ping()
          resolved = true
          this.process?.off('exit', onExit)
          resolve()
          return
        } catch {
          await new Promise(r => setTimeout(r, PING_RETRY_DELAY_MS))
        }
      }
      if (!resolved) {
        resolved = true
        this.process?.off('exit', onExit)
        reject(new Error('Storage daemon not ready after max attempts'))
      }
    }
    poll()
  })
}
```

**Pourquoi:** Le ProxyManager fait deja ce pattern (manager.ts:384-388). Le StorageManager non. Si le binaire storage crash (mauvais binaire, port occupe), on attend 15s pour rien.

### 4. Imports dynamiques -- conversion en statiques

**Fichiers:**
- `src/main/ipc/handlers/navigation.ts` lignes 34, 67
- `src/main/index.ts` ligne 490

**Modification:** Remplacer `const { fn } = await import('./tabs')` par un import statique en haut du fichier. Le module est deja charge statiquement par d'autres fichiers du meme bundle, donc l'import dynamique n'apporte aucun benefice (pas de code splitting, pas de lazy loading reel).

```typescript
// navigation.ts AVANT
const { loadStorageBagInTab } = await import('../../windows/tabs')
// ...
const { fileBrowserCache } = await import('../../windows/tabs')

// navigation.ts APRES
import { loadStorageBagInTab, fileBrowserCache } from '../../windows/tabs'
```

```typescript
// index.ts AVANT (dans le handler app.on('before-quit'))
const { getAllSessions } = await import('./windows/tabs')

// index.ts APRES
import { getAllSessions } from './windows/tabs'
```
