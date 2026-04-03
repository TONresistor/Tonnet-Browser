# Requirements: Startup Optimization

## Problemes identifies

### P1. Bridge pas tue avant retry proxy (bug critique)
- **Fichier:** `src/main/proxy/manager.ts:46-64`
- **Symptome:** `bind: address already in use` sur port 8081 au retry
- **Cause:** La boucle retry met `this.bridgeProcess = null` (ligne 57) sans tuer le process. L'ancien bridge reste vivant. Le nouveau bridge crash sur le port occupe.
- **Impact:** Process orphelin consommant des ressources. Le bridge fonctionne par chance (le wallet se connecte au premier bridge), mais le second process est mort et loggue une erreur.
- **Severite:** Haute. Le bridge orphelin ne sera jamais nettoye sauf a la fermeture de l'app.

### P2. Storage demarre apres le proxy (latence inutile)
- **Fichier:** `src/main/proxy/startup.ts:51-56`
- **Symptome:** Storage attend la fin du `proxyManager.start()` (~20-35s en tunnel) avant de demarrer
- **Cause:** Appel sequentiel: `await proxyManager.start()` puis `await storageManager.start()`
- **Impact:** +0.5-1s de latence ajoutee en serie alors que le storage n'a aucune dependance sur le proxy
- **Severite:** Moyenne. Latence inutile mais fonctionnellement correct.

### P3. Storage daemon sans fail-fast sur crash
- **Fichier:** `src/main/storage/daemon.ts` (waitForReady)
- **Symptome:** Si le binaire `tonutils-storage` crash immediatement (mauvais binaire, port occupe), `waitForReady` attend 15s (30 * 500ms) avant de throw
- **Cause:** La boucle de ping n'ecoute pas l'event `exit` du process. Elle poll l'API HTTP en boucle meme si le process est deja mort.
- **Impact:** 15s perdues en silence quand le storage daemon ne demarre pas
- **Severite:** Moyenne. Latence inutile sur echec, mais ne bloque pas le proxy.

### P4. Proxy et bridge en contention reseau au demarrage
- **Fichier:** `src/main/proxy/manager.ts:96-110`
- **Symptome:** DHT discovery du proxy echoue systematiquement au premier essai ("value is not found" apres 13s), reussit au second quand le bridge a fini son init
- **Cause:** Le proxy et le bridge sont spawnes en meme temps (lignes 96 et 108). Les deux initialisent simultanement:
  - Fetch de la config TON (HTTP)
  - Initialisation du client DHT (UDP, bootstrap nodes)
  - Resolution DNS (requetes liteserver)
  Les sockets UDP, la bande passante et le CPU sont en contention. Le proxy, qui a besoin de decouvrir des tunnel relay nodes via DHT (operation plus lourde), perd la course.
- **Impact:** +15-18s de latence au premier demarrage. Le retry reussit parce que le bridge a fini et libere les ressources.
- **Severite:** Haute. C'est la cause principale du temps de demarrage de 36s.

### P5. Imports dynamiques inutiles (warnings vite)
- **Fichiers:**
  - `src/main/ipc/handlers/navigation.ts:34,67` -- `await import('../../windows/tabs')`
  - `src/main/index.ts:490` -- `await import('./windows/tabs')`
- **Symptome:** Warning vite "dynamically imported but also statically imported"
- **Cause:** `tabs.ts` est importe statiquement par 6 fichiers et dynamiquement par 3. Les imports dynamiques ne servent a rien car le module est deja charge.
- **Impact:** Faible. Warning cosmétique mais bruit dans les logs de build.

## Objectifs

### O1. Eliminer les process orphelins au retry
Quand le proxy echoue et retry, tuer proprement le bridge ET le proxy avant de relancer `startOnce()`.

### O2. Paralleliser les demarrages independants
Lancer le storage daemon en parallele du proxy, pas en serie apres.

### O3. Fail-fast du storage daemon sur crash
Ecouter l'event `exit` du process dans `waitForReady()` pour detecter un crash immediat au lieu d'attendre 15s de ping timeout.

### O4. Differer le demarrage du bridge apres le proxy
Sortir le spawn du bridge de `startOnce()`. Le lancer seulement apres que le proxy est ready. Le bridge sert au wallet (requetes liteserver), pas a la navigation. Il n'a pas besoin d'etre pret au meme moment que le proxy.

### O5. Nettoyer les imports dynamiques inutiles
Convertir les `await import()` de tabs.ts en imports statiques la ou le module est deja charge.

## Hors scope
- Refactoring du ProcessSupervisor (couvert par architecture-hardening)
- Modification des binaires Go
- Optimisation du build vite (743ms est acceptable)
