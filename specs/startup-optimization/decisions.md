# Decisions: Startup Optimization

## D1. stopRunningProcesses() separee plutot que reutiliser stop()

**Decision:** Creer une methode privee `stopRunningProcesses()` plutot que d'appeler `this.stop()` dans la boucle retry.

**Raison:** `stop()` emet les evenements `disconnected` et change le status a `stopped`. Pendant un retry, on ne veut pas que l'UI ou d'autres listeners reagissent a un "disconnect" transitoire. Le cleanup doit etre silencieux.

**Alternative rejetee:** Ajouter un flag `silent` a `stop()`. Ajoute de la complexite a une methode publique pour un cas d'usage interne.

## D2. Defer le bridge apres le proxy, pas en parallele

**Decision:** Le bridge demarre apres que le proxy est ready, pas en meme temps. Le storage demarre en parallele du proxy.

**Raison:** Le proxy et le bridge font tous les deux du bootstrap DHT au demarrage (fetch config TON, init DHT client, resolution DNS). Lances simultanément, ils se disputent les memes sockets UDP et bootstrap nodes. Le proxy perd systematiquement la course car la tunnel relay discovery (son operation DHT) est plus lourde que les requetes liteserver du bridge. Resultat: echec DHT au premier essai, retry obligatoire, +15s.

En differant le bridge, le proxy a le reseau pour lui seul au premier essai. Le bridge n'est pas necessaire pour la navigation (.ton sites), seulement pour le wallet. Le wallet attend deja l'event `ws-bridge-ready` via un listener `once` dans index.ts, donc le delai du bridge est transparent.

**Alternative rejetee:** Garder le lancement simultane et augmenter le timeout DHT. Ca ne resout pas la contention, ca la masque avec un timeout plus long.

## D3. Convertir les imports dynamiques plutot que les supprimer

**Decision:** Remplacer `await import()` par `import` statique en haut du fichier.

**Raison:** Ces modules sont deja charges par le bundle (imports statiques dans d'autres fichiers du meme chunk). L'import dynamique ne fait que creer un micro-delai asynchrone inutile et un warning vite. En les rendant statiques, on elimine le warning et le overhead async.

**Alternative rejetee:** Garder les imports dynamiques et les annoter `/* vite-ignore */`. Ca cache le probleme sans le resoudre.

## D4. Ne pas modifier le binaire Go pour le DHT

**Decision:** Resoudre la contention DHT cote Electron (defer du bridge) plutot que cote Go (modifier tonutils-proxy).

**Raison:** Le probleme n'est pas le comportement DHT du proxy (qui fonctionne au second essai), c'est la contention reseau causee par le bridge. Modifier le binaire Go est hors scope et plus risque. Le defer du bridge est un changement purement applicatif, sans toucher aux binaires.

**Alternative rejetee:** Ajouter un flag `--dht-warmup-delay` au binaire Go. Plus intrusif, necessite de maintenir un fork ou de contribuer upstream.
