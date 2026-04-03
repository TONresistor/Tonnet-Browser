# Research: Startup Optimization

## Process lifecycle management (Node.js/Electron)

### Best practice: kill-before-retry
Source: Node.js child_process docs, ex-ratione.com, Electron production apps

Quand un process enfant echoue et qu'on retry, il faut:
1. Retirer tous les listeners (`removeAllListeners()`) pour eviter les fuites memoire
2. Envoyer SIGTERM avec un timeout de grace
3. SIGKILL apres le timeout si le process ne repond pas
4. Mettre la reference a null seulement APRES la confirmation de mort
5. Attendre un delai avant de relancer (laisser le port se liberer)

Le pattern est: **cleanup -> wait -> retry**, jamais **nullify -> retry** (ce que le code actuel fait).

Point cle: retirer les listeners `onUnexpectedExit` avant SIGTERM pour distinguer un shutdown planifie d'un crash.

### Best practice: port pre-check
Avant de spawn un process qui ecoute sur un port, verifier que le port est libre:

```typescript
import net from 'net'
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => { server.close(); resolve(true) })
    server.listen(port, '127.0.0.1')
  })
}
```

Note: non implemente dans ce spec car le fix du kill-before-retry resout le probleme de port occupe. A considerer si d'autres cas de conflit de port apparaissent.

### Best practice: orphan cleanup au redemarrage
Source: ex-ratione.com

SIGKILL ne peut pas etre intercepte. Si le main process est tue par SIGKILL, les enfants deviennent orphelins. Mitigation: ecrire les PIDs des process enfants dans un fichier au demarrage, le relire au prochain lancement pour tuer les orphelins. Hors scope pour ce spec (couvert par architecture-hardening via ProcessSupervisor).

## Parallelisation de demarrage (Electron)

### Best practice: defer non-critical work
Source: Electron performance docs, Slack/Notion/VSCode engineering blogs

Principes:
- Identifier les dependances reelles entre composants
- Tout ce qui n'a pas de dependance directe peut etre lance en parallele
- Utiliser `Promise.allSettled()` pour les taches paralleles avec tolerance d'erreur
- Les taches non-critiques (storage, analytics, updater) ne doivent pas bloquer le rendu
- Creer la BrowserWindow immediatement, afficher un etat "connecting..." pendant que les daemons demarrent

### Techniques avancees (reference, hors scope)
- **V8 Snapshots** (VSCode): pre-initialise le heap, gain ~50% sur le cold start. Complexe a maintenir.
- **Defer require()**: charger les modules lourds au moment de l'usage, pas au top-level.
- **Eviter fs.readFileSync** dans le chemin critique: bloque l'event loop.

### Application a Tonnet
- Le storage daemon n'a aucune dependance sur le proxy: meme config reseau mais processes independants
- Le storage est non-critique: un echec n'empeche pas la navigation
- Le bridge est lie au proxy: meme cycle de vie, meme reseau

## DHT bootstrap (P2P)

### Best practice: retry avec backoff + jitter
Source: libp2p/go-libp2p-kad-dht, IPFS, Kademlia specs, AWS retry guidance

Le DHT a besoin d'un nombre minimum de peers dans sa table de routage avant de pouvoir resoudre des cles. A froid, la discovery peut echouer car le client n'a pas encore contacte assez de bootstrap nodes.

**Patterns valides en production (go-libp2p-kad-dht):**
- Bootstrap run au demarrage, puis periodique toutes les 2 minutes
- Seuil: si routing table < 10 peers et nouveau peer vu, bootstrap force
- `ForceRefresh()` pour rafraichir tous les buckets
- Backoff exponentiel: `wait = base * 2^attempt + random_jitter` (jitter +/-20% pour eviter thundering herd)

**TON specifique:** `global.config.json` contient les bootstrap nodes DHT. Le binaire gere son propre DHT. On ne peut pas modifier son comportement sans changer le code Go. Le retry au niveau du manager (2s delai fixe) est suffisant.

### Liveness vs Readiness (pattern Kubernetes adapte)
Source: recherche P2P, patterns de supervision

Distinction importante pour les daemons P2P:
- **Liveness**: le process repond-il? (port ouvert, ping OK) -- declenche un restart si non
- **Readiness**: le process est-il pret a traiter des requetes? (DHT bootstrappe, peers suffisants) -- bloque le trafic mais ne tue pas

Pour tonutils-proxy: le process peut etre "alive" (demarre, port ouvert) mais pas encore "ready" (DHT pas encore bootstrappe). Le code actuel ne fait pas cette distinction: `waitForReady` attend "starting proxy server" (qui combine les deux).

Note: cette separation est geree par le ProcessSupervisor dans architecture-hardening. Ce spec ne l'implemente pas.

## Fail-fast sur crash daemon

### Best practice: ecouter exit dans waitForReady
Source: analyse du code storage/daemon.ts

Quand un process daemon est spawne et qu'on poll son API pour la readiness, il faut aussi ecouter l'event `exit`. Si le process meurt avant d'etre ready, inutile de poll pendant 15s. Pattern:

```typescript
async waitForReady(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Fail-fast si le process crash
    const onExit = (code: number | null) => {
      reject(new Error(`Daemon exited before ready (code: ${code})`))
    }
    this.process.once('exit', onExit)

    // Poll readiness
    const poll = async () => {
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        try {
          await this.client.ping()
          this.process.off('exit', onExit)
          resolve()
          return
        } catch {
          await sleep(RETRY_DELAY_MS)
        }
      }
      this.process.off('exit', onExit)
      reject(new Error('Daemon not ready after max attempts'))
    }
    poll()
  })
}
```

Le ProxyManager fait deja ce pattern (manager.ts:384-388). Le StorageManager ne le fait pas.

## Vite mixed imports

### Best practice: coherence des imports
Source: Vite docs, Rollup bundle analysis

Quand un module est importe a la fois statiquement et dynamiquement dans le meme chunk:
- L'import dynamique ne cree pas de code splitting
- Le module est inclus dans le chunk principal de toute facon
- Le `await import()` ajoute un tick async inutile
- Vite emettra un warning a chaque build

Solution: convertir en import statique si le module est deja dans le meme chunk.

## Sources

- [Die, Child Process, Die (ex-ratione)](https://www.exratione.com/2013/05/die-child-process-die/)
- [Node.js Graceful Shutdown in Production](https://dev.to/axiom_agent/nodejs-graceful-shutdown-in-production)
- [How to make Electron launch 1000ms faster](https://www.devas.life/how-to-make-your-electron-app-launch-1000ms-faster/)
- [Slack/Notion/VSCode Electron performance](https://palette.dev/blog/improving-performance-of-electron-apps)
- [Electron Performance docs](https://www.electronjs.org/docs/latest/tutorial/performance)
- [go-libp2p-kad-dht bootstrap](https://github.com/libp2p/go-libp2p-kad-dht/blob/master/dht_bootstrap.go)
- [libp2p Kademlia DHT docs](https://docs.libp2p.io/concepts/discovery-routing/kaddht/)
- [TON DHT service docs](https://docs.ton.org/v3/documentation/network/protocols/dht/ton-dht)
- [AWS retry-backoff guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/retry-backoff.html)
- [IPFS bootstrap reliability](https://blog.ipfs.tech/2023-rust-libp2p-based-ipfs-bootstrap-node/)
