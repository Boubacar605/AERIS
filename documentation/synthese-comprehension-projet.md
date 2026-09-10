# Synthese de comprehension du projet AERIS

> Document de reference pour tout agent reprenant le projet.
> Genere le 2026-09-10. Derniere validation : en attente.

---

## 1. Resume du projet

**AERIS** (Architecture Edge-Cloud pour la Radiologie Intelligente au Senegal) est un prototype experimental de triage radiologique assiste par IA, concu dans le cadre d'un Master 2 Systemes d'Information a l'UADB (Senegal), presente par Boubacar NIANG (annee 2025-2026).

Le systeme analyse des radiographies thoraciques pour detecter deux pathologies — **tuberculose** et **pneumonie** — et route dynamiquement l'inference entre un noeud **Edge** (local, ressources limitees) et un **Cloud** (distant, ressources abondantes) en fonction de l'etat des ressources et de la qualite reseau.

La contribution est **architecturale et experimentale** : l'IA est un composant, l'orchestration Edge/Cloud est le coeur du sujet. Le projet doit fonctionner en demo devant un jury.

---

## 2. Cartographie des composants

### 2.1 Services IA — Python / FastAPI

#### Service Tuberculose (`services/service-tuberculose/`)
- **Role** : Inference CNN sur radiographies thoraciques pour la detection de tuberculose
- **Port** : 8001 (Edge : 8011)
- **Modeles** : `modele_tuberculose.h5` (Edge, 96x96 RGB, softmax 2 classes) + `modele_tuberculose_cloud.h5` (Cloud, 320x320 RGB, sigmoid)
- **Etat** : Fonctionnel — code complet, 3 tests pytest, Dockerfile, routes operationnelles
- **Note** : dependance `httpx` dans requirements.txt mais jamais importee (inutilisee)

#### Service Pneumonie (`services/service-pneumonie/`)
- **Role** : Inference CNN pour la detection de pneumonie
- **Port** : 8002 (Edge : 8012)
- **Modeles** : `modele_pneumonie.h5` (Edge, 150x150 grayscale, sigmoid) + `modele_pneumonie_cloud.h5` (Cloud, 320x320 RGB, sigmoid)
- **Etat** : Fonctionnel — code complet, 3 tests pytest, Dockerfiles separes Edge/Cloud
- **Note** : a deux Dockerfiles (`Dockerfile` + `Dockerfile.edge`) et deux requirements (`requirements.txt` TF 2.16.2 / `requirements.edge.txt` TF 2.15.0)

### 2.2 Moteur de Decision (`services/moteur-decision/`)
- **Role** : Point d'entree unique — evalue les metriques systeme, decide Edge vs Cloud, route l'image, agregre les resultats
- **Port** : 8003
- **Etat** : Fonctionnel — code complet, 8 tests pytest, CORS configure, logique de decision operationnelle
- **Logique** : 5 regles de priorite (reseau indisponible → Edge, latence > seuil → Edge, CPU > 80% → Cloud, RAM > 85% → Cloud, sinon → Edge)
- **Correction appliquee** : Le moteur de decision est desormais inclu dans les profils `edge` et `cloud` (pas seulement `complet`). Les dependances ont ete rendues optionnelles (`required: false`).

### 2.3 Tableau de Bord (`tableau-de-bord/`)
- **Role** : Interface React pour le personnel medical
- **Port** : 3000
- **Etat** : Partiellement fonctionnel
  - **PageDiagnostic** — interactive, appels API reels, mode comparaison Edge/Cloud
  - **PageMonitoring** — donnees en temps reel via polling `/etat-systeme`
  - **PageAccueil** — donnees **mock hardcodees** (pas d'appels API) — etat d'avancement connu, a traiter ulterieurement
  - **PageHistorique** — tableau **statique** avec donnees fictives — etat d'avancement connu, a traiter ulterieurement
  - **Aucun test** frontend
- **Design system** : palette AERIS personnalisee (13 couleurs), typographie (Space Grotesk / IBM Plex Sans / JetBrains Mono), layout sidebar fixe 264px

### 2.4 Infrastructure
- **Prometheus** (`infrastructure/prometheus/prometheus.yml`) — 5 jobs de scrape, intervalle 5s
- **Script de demarrage** (`infrastructure/scripts/demarrage.sh`) — gestion des profils Docker Compose
- **Docker Compose** — 7 services, 4 profils (`cloud`, `edge`, `complet`, `monitoring`), limites de ressources Edge configurables

### 2.5 Donnees et Explorations
- **Donnees test** (`donnees/`) — 10 images pneumonie (JPEG) + 10 images tuberculose (PNG), organisees par classe
- **Carnets d'exploration** (`carnets-exploration/`) — 4 notebooks Jupyter contenant le code d'entrainement complet
- **Experimentations** (`experimentations/`) — 3 scenarios + dossier resultats, tous vides (`.gitkeep` uniquement)

### 2.6 Carnets d'exploration — Procedure de regeneration des modeles

Les 4 notebooks contiennent le code complet d'entrainement et de sauvegarde des modeles `.h5` :

| Notebook | Modele genere | Algorithme | Dataset | Entrees |
|----------|---------------|------------|---------|---------|
| `notebook-modele-tuberculose.ipynb` | `model.h5` → Edge TB | CNN Sequential (Conv2D 32/64/128 + Dense 2 softmax) | Shenzhen + Montgomery (~800 images) | 96x96 RGB |
| `notebook-modele-tuberculose-cloud.ipynb` | weights `.ckpt` → Cloud TB | DenseNet121 (transfer learning, 1 sigmoid) | TB Chest Radiography Database (4200 images) | 320x320 RGB |
| `notebook-modele-pneumonie.ipynb` | model → Edge PN | CNN Sequential (Conv2D 32/64/128/256 + Dense 1 sigmoid) | Chest X-Ray Kaggle (5863 images) | 150x150 grayscale |
| `notebook-lung-opacity-reference.ipynb` | `full_model.h5` | VGG16 (transfer learning, reference) | RSNA Pneumonia Detection | 384x384 RGB |

**Attention** : les notebooks ont ete executes sur Kaggle (chemins `/kaggle/input/`). Pour les regenerer localement, il faudra adapter les chemins d'entree. Les datasets doivent etre telecharges manuellement (voir `donnees/README.md`).

---

## 3. Conventions de developpement

### 3.1 Regles engageantes

| Domaine | Convention |
|---------|-----------|
| **Langue** | Tous les fichiers/dossiers en francais sauf noms imposes par les outils (`Dockerfile`, `package.json`, etc.) |
| **Commits** | Conventional Commits en francais, sans accents, sans scope : `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:` |
| **Branches** | `main` (stable), `develop` (integration), `feat/<nom>`, `fix/<nom>` |
| **Python** | 3.11+, type hints obligatoires, black (100 car), ruff, docstrings en francais |
| **TypeScript** | `strict: true`, ESLint + Prettier, commentaires en francais |
| **Architecture Python** | FastAPI avec routers separes (sante, diagnostic/routage), Pydantic v2, pydantic-settings, `prometheus-fastapi-instrumentator` |
| **Structure services** | `app/principal.py` (entree), `app/config.py` (config), `app/routes/`, `app/schemas/`, `app/coeur/` (logique metier), `app/tests/` |
| **Tests** | pytest avec `unittest.mock` pour eviter les dependances ML, 3+ tests par service IA |
| **Conteneurisation** | Dockerfile `python:3.11-slim`, healthcheck sur `/sante`, reseau bridge `aeris-reseau` |
| **Modeles IA** | Pre-entraînes (CNN Keras), pas d'entrainement from-scratch, fichiers `.h5` dans `modeles_entraines/` (gitignores) |

### 3.2 Stack technique par composant

| Composant | Language | Framework | Port | ML Runtime |
|-----------|----------|-----------|------|------------|
| service-tuberculose | Python 3.11 | FastAPI 0.109.0 | 8001 | TensorFlow 2.15.0 |
| service-pneumonie | Python 3.11 | FastAPI 0.109.0 | 8002 | TF 2.15.0 (edge) / 2.16.2 (cloud) |
| moteur-decision | Python 3.11 | FastAPI 0.109.0 | 8003 | Aucun (HTTP routing) |
| tableau-de-bord | TypeScript/React | Vite + React 18 | 3000 | Aucun (UI) |

---

## 4. Decisions de design/architecture deja actees

### ADR-0001 : Architecture microservices (Acceptee)
- **Decision** : Un service par pathologie (TB et PN separes)
- **Justification** : Tolerance aux pannes, deploiement independant, scalabilite, coherence avec la problematique
- **Consequences** : Complexite operationnelle accrue, communication HTTP inter-services

### Choix technologiques documents
- **FastAPI** pour tous les services Python (performance, async, auto-doc OpenAPI)
- **Prometheus** pour le monitoring (standard industrie, pas de Grafana dans le scope actuel — un dashboard Grafana minimal sera ajoute plus tard pour la demo)
- **Edge simule** via Docker avec limites CPU/RAM (pas de hardware physique necessaire)
- **Communication** : HTTP/REST (JSON) entre tous les services, decouplage total
- **SQLite** pour la persistance de l'historique (suffisant pour un prototype de demo)
- **Securite/authentification** : hors perimetre de maniere assumee. A documenter comme limite du prototype.

### Design UI (tableau-de-bord)
- **Palette AERIS** : 13 couleurs personnalisees dans `tailwind.config.js`
- **Typographie** : Space Grotesk (titres), IBM Plex Sans (corps), JetBrains Mono (donnees techniques)
- **Layout** : sidebar fixe 264px + contenu principal
- **Injection API** : `VITE_URL_API` injectee au build time via variable d'environnement dans docker-compose.yml

---

## 5. Ecarts detects et corrections appliquees

| # | Ecart | Correction |
|---|-------|-----------|
| 1 | README racine mentionnait "ONNX Runtime" | **Corrige** : remplace par "TensorFlow/Keras". Pas d'autres mentions ONNX dans le projet. |
| 2 | Profil Docker `edge` excluait le moteur de decision | **Corrige** : `moteur-decision` ajoute aux profils `cloud` et `edge`, dependances rendues optionnelles (`required: false`). |
| 3 | PageAccueil et PageHistorique en donnees mock | **Non corrige** : etat d'avancement connu et attendu a ce stade. A traiter comme tache de developpement ulterieure. |

### Ecarts mineurs non corriges (a traiter ulterieurement)
- `httpx` dans requirements.txt de service-tuberculose : installe mais jamais importe
- Schema `RequeteDiagnostic` defini mais jamais utilise dans les route handlers
- Aucun README pour le tableau-de-bord
- Un seul ADR documente (0001)
- Aucun test frontend

---

## 6. Zones d'ombre — decisions prises

| # | Question | Decision |
|---|----------|----------|
| 1 | Modeles IA — comment les generer ? | Les 4 notebooks contiennent le code complet. Documenter la procedure dans `carnets-exploration/README.md`. |
| 2 | Persistance de l'historique | **SQLite** — suffisant pour un prototype de demo. |
| 3 | Authentification / securite | **Hors perimetre**, de maniere assumee. A documenter comme limite. |
| 4 | Grafana | Un dashboard Grafana **sera ajoute plus tard** pour la demo. |
| 5 | Scenarios d'experimentation vides | **Priorite haute** — coeur de la methodologie du memoire. Proposition de structure demandee. |
| 6 | Comparaison Edge vs Cloud | **Confirmee** — evaluation comparative precision/latence entre versions Edge et Cloud de chaque modele. |
| 7 | Mode de degradation (service Edge down) | **Tache a part entiere** — le moteur de decision doit basculer automatiquement ou signaler l'erreur explicitement. |
| 8 | Profil Docker edge sans moteur | **Corrige** — cf. ecart #2 ci-dessus. |
| 9 | Injection VITE_URL_API | **Verifie** — injectee au build time via docker-compose.yml, conforme. |
| 10 | Script de demo jury | **A creer** une fois les scenarios d'experimentation implementes. |

---

## 7. Taches a venir (priorisees)

1. **Scenarios d'experimentation** — structure et scripts (en cours de validation)
2. **Mode de degradation** — le moteur de decision doit gerer l'indisponibilite des services Edge
3. **PageAccueil dynamique** — remplacer les donnees mock par des appels API
4. **PageHistorique avec SQLite** — persistance des resultats de diagnostic
5. **Evaluation comparative Edge vs Cloud** — precision et latence par modele
6. **Script de demo jury** — rejouer les 3 scenarios en direct
7. **Dashboard Grafana** — visualisation des metriques Prometheus pour la demo
