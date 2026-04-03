# Spec: Startup Optimization

**Target:** Startup rapide, fiable, sans process orphelins
**Date:** 2026-04-03
**Status:** Draft
**Author:** TONresistor + Claude
**Complexity:** Story (3-5 fichiers, 1 session)
**Depends on:** Aucun (peut etre implemente avant ou apres architecture-hardening)

## Files
- [requirements.md](requirements.md) -- Problemes, objectifs, scope
- [architecture.md](architecture.md) -- Design, diagrammes avant/apres
- [decisions.md](decisions.md) -- Decisions techniques avec justifications
- [research.md](research.md) -- Best practices, sources, patterns industrie
- [tasks.md](tasks.md) -- Taches d'implementation avec dependances

## Success Criteria
- [ ] Zero process orphelin apres un retry proxy (bridge tue avant relance)
- [ ] Storage daemon demarre en parallele du proxy (pas apres)
- [ ] Bridge demarre apres readiness proxy (plus de contention DHT)
- [ ] Temps de demarrage reduit de ~36s a ~20s en mode tunnel
- [ ] Aucun "address already in use" dans les logs de retry
- [ ] Storage daemon fail-fast sur crash (exit detecte en <1s, pas 15s de timeout)
- [ ] Imports dynamiques inutiles convertis en imports statiques
- [ ] `npm run validate` passe (tsc + lint + tests)
- [ ] Zero regression sur les features existantes

## Boundaries
### Always Do
- Tuer tous les process enfants avant d'en relancer de nouveaux
- Verifier que les features existantes (wallet, bridge, storage) fonctionnent apres changement
- Lancer `npm run validate` apres chaque phase

### Ask First
- Modification des binaires Go (ajout de flags, changement de comportement DHT)
- Changement du timeout de connexion par defaut (30s)

### Never Do
- Casser l'API IPC du proxy/storage status
- Modifier les settings schema de facon breaking
- Introduire de nouvelles dependances npm
