# Tasks: Startup Optimization

## Phase 1: Fix du bug bridge (critique)

### T1.1 Ajouter `stopRunningProcesses()` dans ProxyManager
- **Fichier:** `src/main/proxy/manager.ts`
- **Action:** Extraire la logique de kill de `stop()` en methode privee reutilisable
- **Verification:** La methode tue les process enfants sans emettre `disconnected` ni changer le status
- **Depends on:** rien

### T1.2 Appeler `stopRunningProcesses()` dans la boucle retry
- **Fichier:** `src/main/proxy/manager.ts:46-64`
- **Action:** Remplacer les lignes `this.process = null; this.bridgeProcess = null` par `await this.stopRunningProcesses()`
- **Verification:** Au retry, le bridge est tue et le port 8081 est libere avant le nouveau spawn
- **Depends on:** T1.1

### T1.3 Extraire le spawn bridge dans une methode `startBridge()`
- **Fichier:** `src/main/proxy/manager.ts`
- **Action:** Sortir le spawn du bridge et ses handlers de `startOnce()`. Creer `private async startBridge()`. Appeler `startBridge()` apres `waitForReady()` dans `startOnce()`.
- **Verification:** Le bridge demarre seulement apres que le proxy log "Proxy is ready"
- **Depends on:** T1.1

### T1.4 Test manuel du demarrage
- **Action:** Lancer le browser et verifier dans les logs:
  - Le proxy fait sa DHT discovery SEUL (pas de logs "[bridge]" pendant la discovery)
  - Le bridge demarre apres "Proxy is ready"
  - Aucun "address already in use"
  - Le wallet se connecte au bridge
  - Mesurer le temps: objectif <20s en tunnel (vs 36s avant)
- **Depends on:** T1.2, T1.3

## Phase 2: Parallelisation storage

### T2.1 Modifier `startProxySequence()` pour lancer storage en parallele
- **Fichier:** `src/main/proxy/startup.ts`
- **Action:** Lancer `storageManager.start()` avant `await proxyManager.start()`, attendre les deux avec `Promise.allSettled` semantique
- **Verification:** Dans les logs, les messages storage apparaissent pendant la phase proxy, pas apres
- **Depends on:** rien

### T2.2 Verifier que storage fonctionne sans proxy
- **Action:** Confirmer que le storage daemon n'utilise pas le proxy HTTP (port 8080) pour ses operations
- **Verification:** Storage API repond sur port 5555 meme si le proxy n'est pas encore connecte
- **Depends on:** T2.1

## Phase 3: Storage fail-fast

### T3.1 Ajouter fail-fast sur exit dans StorageManager.waitForReady()
- **Fichier:** `src/main/storage/daemon.ts`
- **Action:** Ecouter l'event `exit` du process pendant le poll de readiness. Si le process meurt, reject immediatement au lieu d'attendre 15s de ping timeout.
- **Verification:** Si le binaire storage est absent ou crash, l'erreur apparait en <1s au lieu de 15s
- **Depends on:** rien

## Phase 4: Cleanup imports

### T4.1 Convertir les imports dynamiques de tabs.ts
- **Fichiers:**
  - `src/main/ipc/handlers/navigation.ts` (lignes 34, 67)
  - `src/main/index.ts` (ligne 490)
- **Action:** Remplacer `await import()` par `import` statique
- **Verification:** Les warnings vite disparaissent du build. Aucune regression fonctionnelle.
- **Depends on:** rien

### T4.2 Verifier les warnings vite
- **Action:** `npm run dev` et confirmer absence des deux warnings "dynamically imported but also statically imported"
- **Depends on:** T4.1

## Phase 5: Validation

### T5.1 Validation complete
- **Action:** `npm run validate` (tsc + lint + tests)
- **Depends on:** T1.4, T2.2, T3.1, T4.2

### T5.2 Test de demarrage complet
- **Action:** Lancer le navigateur et verifier:
  - Proxy connecte (tunnel mode)
  - Bridge WS actif
  - Wallet charge
  - Storage API accessible
  - Temps de demarrage mesure (objectif: <25s en tunnel, <10s en direct)
- **Depends on:** T5.1

## Estimation
- **Phase 1:** 15 min (fix bridge retry + test)
- **Phase 2:** 10 min (parallelisation storage)
- **Phase 3:** 10 min (storage fail-fast)
- **Phase 4:** 5 min (cleanup imports)
- **Phase 5:** 10 min (validation + test)
- **Total:** ~50 min
