# AUDIT COMPLET — AERIS
> Généré le 26 septembre 2026 · Lu avant tout développement

---

## 1. VUE D'ENSEMBLE

### 1.1 Ce que fait le projet en une phrase
**AERIS** (*Architecture Edge-cloud pour la Radiologie Intelligente au Sénégal*) est une plateforme distribuée et adaptative de triage radiologique assisté par IA (détection conjointe de la tuberculose et de la pneumonie) capable d'arbitrer automatiquement, en temps réel et selon les contraintes de ressources locales et de réseau, l'exécution des inférences entre un nœud **Edge** (local, contraint) et un nœud **Cloud** (distant, haute capacité), tout en intégrant la notification sécurisée par code OTP (Email/WhatsApp) et la consultation de compte rendu médical pour le patient.

### 1.2 Stack technologique complète avec versions
- **Backend & Moteur de Décision** : Python 3.11, FastAPI `0.109.0`, Uvicorn `0.27.0`, Pydantic `2.5.3`, Pydantic-Settings `2.1.0`, HTTPX `0.26.0`, Psutil `5.9.7`, Pillow `10.2.0`, Pytest `7.4.4`, Pytest-Asyncio `0.23.3`.
- **Persistance & Base de données** : PostgreSQL 16 (image `postgres:16-alpine`), SQLAlchemy `2.0.25` (mode asynchrone avec `asyncio`), Psycopg 3 (`psycopg[binary]==3.1.18`), Alembic `1.13.1`.
- **Authentification & Sécurité** : PyJWT `2.8.0`, Passlib `1.7.4`, Bcrypt `4.0.1`.
- **Messagerie & Notifications** : `aiosmtplib 3.0.1` (SMTP transactionnel), MailHog (SMTP dev local), Google Gmail SMTP (production), Node.js v22 + `whatsapp-web.js 1.26.0` (Puppeteer / Chromium headless) + `qrcode-terminal 0.12.0` (Relais WhatsApp).
- **Services IA & Deep Learning** : Python 3.11, TensorFlow `2.15.0` (Edge & Cloud TB) et `2.16.2` (Cloud PN), NumPy `1.26.3`, Pillow `10.2.0`, modèles Keras `.h5` pré-entraînés (CNN séquentiels légers pour l'Edge, architectures DenseNet121 pour le Cloud).
- **Frontend** : React 18, TypeScript 5.2 (`strict: true`), Vite 5, TanStack Router (`@tanstack/react-router`), TailwindCSS 3.4 (design system AERIS 13 couleurs), Lucide React, Recharts 2.12, jsPDF 2.5 (génération de comptes rendus PDF côté client).
- **Monitoring & Observabilité** : Prometheus `v2.48.0` + `prometheus-fastapi-instrumentator 6.1.0`.
- **Infrastructure & Réseau** : Docker, Docker Compose v2 (profils: `complet`, `cloud`, `edge`, `monitoring`), Nginx (reverse-proxy port 8080), Tailscale Funnel (tunnel HTTPS public persistant port 443 avec hooks systemd-sleep).

### 1.3 Inventaire des services
| Service | Dossier | Rôle synthétique |
|---|---|---|
| **moteur-decision** | `services/moteur-decision/` | Passerelle API, algorithme de routage adaptatif Edge/Cloud, profilage d'image, contrôle qualité/escalade, RBAC, persistance PostgreSQL et envoi de notifications OTP. |
| **service-tuberculose** | `services/service-tuberculose/` | Microservice d'inférence spécialisé dans la détection de la tuberculose (CNN 96x96 en Edge, DenseNet121 320x320 en Cloud). |
| **service-pneumonie** | `services/service-pneumonie/` | Microservice d'inférence spécialisé dans la détection de la pneumonie (CNN 150x150 niveaux de gris en Edge, DenseNet121 320x320 en Cloud). |
| **relay-whatsapp** | `services/relay-whatsapp/` | Relais WhatsApp autonome sous Node.js/Puppeteer émulant un client WhatsApp Web pour transmettre les liens et codes OTP aux patients. |
| **tableau-de-bord** | `tableau-de-bord/` | Interface web monopage (SPA) pour le personnel soignant (triage, monitoring, gestion des patients, approbation des examens) et portail de consultation patient par OTP. |
| **postgres** | `infrastructure/postgres/` | SGBD relationnel PostgreSQL 16 assurant la persistance 3NF des patients, examens, diagnostics, résultats, escalades et télémétrie. |
| **prometheus** | `infrastructure/prometheus/` | Collecteur de métriques temps réel scrapant périodiquement (toutes les 5s) les sondes `/metrics` des microservices Python. |
| **mailhog** | Docker compose | Serveur SMTP de développement capturant les courriels OTP avec interface de visualisation web intégrée. |

### 1.4 Schéma ASCII de l'architecture globale et flux de données

```
                                      [ NAVIGATEUR CLIENT ]
                                                 │
                                                 │ HTTPS (Tailscale Funnel :443)
                                                 │ ou HTTP direct (:3000 / :8003)
                                                 ▼
                             ┌───────────────────────────────────────┐
                             │       TABLEAU DE BORD (React)         │
                             │  Port 3000 — UI Triage & Accès Patient│
                             └───────────────────┬───────────────────┘
                                                 │
                                                 │ REST / JSON + Multipart Upload
                                                 ▼
                             ┌───────────────────────────────────────┐
                             │      MOTEUR DE DÉCISION (FastAPI)     │
                             │      Port 8003 — Orchestrateur        │
                             └───────┬───────────┬───────────┬───────┘
                                     │           │           │
            ┌────────────────────────┘           │           └────────────────────────┐
            │ Sondage télémétrie                 │ Persistance & RBAC                 │ Notifications OTP
            ▼                                    ▼                                    ▼
┌───────────────────────┐            ┌───────────────────────┐            ┌───────────────────────┐
│ PROMETHEUS / PSUTIL   │            │     POSTGRESQL 16     │            │    RELAY-WHATSAPP     │
│ Port 9090             │            │ Port 5433 (3NF + Vues)│            │ Port 3500 (Node.js)   │
└───────────────────────┘            └───────────────────────┘            └───────────┬───────────┘
            │                                                                         │
            ▼ Décision de Routage (Latence, CPU, RAM)                                 ▼ Message WhatsApp
┌───────────────────────────────────────────────────────────────────┐     ┌───────────────────────┐
│                       PIPELINE D'INFÉRENCE                        │     │    PATIENT MOBILE     │
│                                                                   │     │  Réception Code OTP   │
│   ┌─────────────────────────────┐   ┌─────────────────────────┐   │     └───────────┬───────────┘
│   │        NŒUD EDGE            │   │       NŒUD CLOUD        │   │                 │
│   │ (Simulé Docker CPU/RAM)     │   │ (Ressources Illimitées) │   │                 │ Consultation PDF
│   │                             │   │                         │   │                 ▼
│   │ • TB Edge (:8011)           │   │ • TB Cloud (:8001)      │   │     ┌───────────────────────┐
│   │   CNN 96x96 RGB             │   │   DenseNet121 320x320   │   │     │  PORTAIL RÉSULTAT     │
│   │ • PN Edge (:8012)           │   │ • PN Cloud (:8002)      │   │     │  Validation & Téléch. │
│   │   CNN 150x150 Grayscale     │   │   DenseNet121 320x320   │   │     │  du PDF Clinique      │
│   └─────────────────────────────┘   └─────────────────────────┘   │     └───────────────────────┘
│                                  ▲                                │
│                                  │ Filet de sécurité / Escalade   │
└──────────────────────────────────┴────────────────────────────────┘
```

---

## 2. CARTOGRAPHIE DÉTAILLÉE

### 2.1 Moteur de Décision (`services/moteur-decision`)
- **Rôle** : Cœur de l'architecture. Reçoit les radiographies, profile l'image (format/ratio), sonde les métriques du système (CPU, RAM locale, latence réseau Cloud), applique l'algorithme de routage, délègue aux microservices IA, orchestre le filet de sécurité (escalade), persiste les résultats de manière asynchrone dans PostgreSQL, gère l'authentification des soignants (RBAC) et l'émission des OTPs.
- **Technologie** : Python 3.11, FastAPI, SQLAlchemy 2.0 Async, HTTPX, Pillow, Psutil.
- **Port** : `8003` (interne et hôte).
- **Endpoints exposés** :
  - `GET /` : Informations de version, seuils configurés et état du moteur.
  - `GET /sante` : Healthcheck standard du moteur.
  - `GET /etat-systeme` : Télémétrie complète (CPU, RAM, disque, latence Cloud, décision projetée en temps réel).
  - `POST /routage/analyser` : Endpoint central d'analyse radiologique (`fichier`, `force_destination`, `contexte`, `id_patient`).
  - `GET /historique` : 100 derniers diagnostics avec métriques, verdicts et traces d'escalade.
  - `POST /auth/connexion` : Authentification soignant (OAuth2 password flow), délivre un JWT Bearer.
  - `GET /auth/profil` : Identité et rôle du compte connecté (`admin`, `medecin`, `technicien`).
  - `POST /admin/utilisateurs` : Création de compte soignant (réservé `admin`).
  - `GET /admin/patients` : Liste des dossiers patients avec leurs examens associés.
  - `POST /admin/patients` : Création d'un dossier patient anonymisé.
  - `POST /admin/examens/{id}/approuver` : Validation médicale d'un examen, génération du code OTP et envoi multicanal.
  - `POST /admin/patients/{id}/renvoyer-otp` : Régénération et renvoi d'un OTP pour un patient donné.
  - `GET /acces-resultat` : Consultation publique protégée par OTP pour le patient (`code_otp` + `contact`).
  - `GET /metrics` : Métriques Prometheus instrumentées.
- **Dépendances** : Appelle `service-tuberculose-edge:8001`, `service-tuberculose-cloud:8001`, `service-pneumonie-edge:8002`, `service-pneumonie-cloud:8002`, `relay-whatsapp:3500`, `postgres:5432`, `mailhog:1025` / SMTP Gmail.
- **Appelé par** : `tableau-de-bord`, scripts d'expérimentation, tests d'intégration.
- **Points d'attention** : En cas d'indisponibilité de PostgreSQL, le moteur bascule en mémoire vive sans bloquer le pipeline d'inférence (dégradation gracieuse documentée dans l'ADR-0003).

### 2.2 Service Tuberculose (`services/service-tuberculose`)
- **Rôle** : Inférence spécialisée dans le dépistage de la tuberculose sur clichés pulmonaires.
- **Technologie** : Python 3.11, FastAPI, TensorFlow/Keras 2.15.0, NumPy, Pillow.
- **Ports** : `8001` (Cloud) / `8011:8001` (Edge).
- **Endpoints exposés** :
  - `GET /` : Métadonnées du service, pathologie et mode actif (`edge` ou `cloud`).
  - `GET /sante` : Uptime et état du service.
  - `GET /metriques-systeme` : Consommation CPU, RAM et disque du conteneur via Psutil.
  - `POST /diagnostic/analyser` : Inférence sur fichier image (multipart `fichier: UploadFile`).
  - `GET /metrics` : Métriques Prometheus.
- **Dépendances** : Aucune dépendance sortante. Lit les modèles sur disque (`/app/modeles_entraines/`).
- **Appelé par** : `moteur-decision`.
- **Points d'attention** : Modèle Edge (CNN séquentiel 96x96 RGB, sortie Softmax 2 classes `[Normal, TB]`) vs Modèle Cloud (DenseNet121 320x320 RGB, sortie Sigmoïde 1 neurone). Le chargement du modèle est lazy (singleton au premier appel).

### 2.3 Service Pneumonie (`services/service-pneumonie`)
- **Rôle** : Inférence spécialisée dans la détection de la pneumonie sur clichés pulmonaires.
- **Technologie** : Python 3.11, FastAPI, TensorFlow 2.15.0 (Edge via `requirements.edge.txt`) / 2.16.2 (Cloud), NumPy, Pillow.
- **Ports** : `8002` (Cloud) / `8012:8002` (Edge).
- **Endpoints exposés** :
  - `GET /` : Métadonnées du service, pathologie et mode actif.
  - `GET /sante` : Uptime et état du service.
  - `GET /metriques-systeme` : Consommation CPU, RAM et disque du conteneur.
  - `POST /diagnostic/analyser` : Inférence sur fichier image (multipart `fichier: UploadFile`).
  - `GET /metrics` : Métriques Prometheus.
- **Dépendances** : Aucune dépendance sortante.
- **Appelé par** : `moteur-decision`.
- **Points d'attention** : **Seuils inversés critiques** : Sur le modèle Edge (CNN 150x150 en niveaux de gris), `score < 0.5` indique une Pneumonie (`confiance = 1.0 - score`). Sur le modèle Cloud (DenseNet121 320x320 RGB), `score >= 0.5` indique une Pneumonie (`confiance = score`). Cette inversion découle de l'encodage des labels lors de l'entraînement Kaggle.

### 2.4 Relais WhatsApp (`services/relay-whatsapp`)
- **Rôle** : Passerelle d'envoi de messages WhatsApp pour les codes OTP sans dépendance d'API payante Meta Cloud.
- **Technologie** : Node.js 22, CommonJS, `whatsapp-web.js` (Puppeteer Chromium headless), `qrcode-terminal`.
- **Port** : `3500`.
- **Endpoints exposés** :
  - `GET /sante` : État de connexion WhatsApp (`ouvert`, `en_attente`, `bloque`, `deconnecte`).
  - `GET /existe?to=<numero>` : Vérification de l'existence d'un compte WhatsApp pour un numéro.
  - `POST /envoyer` : Envoi d'un message texte WhatsApp (`to`, `message`).
  - `GET /statut/:id` : Consultation de l'accusé de réception d'un message (`en_attente`, `envoye_serveur`, `delivre`, `lu`).
- **Dépendances** : Navigateur Chromium système Debian (`/usr/bin/chromium`), volume persistant `/app/.wwebjs_auth`.
- **Appelé par** : `moteur-decision`.
- **Points d'attention** : Pas d'authentification HTTP sur le port 3500 (protégé uniquement par le réseau interne Docker). Nettoie automatiquement les verrous Chromium `SingletonLock` au démarrage.

### 2.5 Tableau de Bord Frontend (`tableau-de-bord`)
- **Rôle** : Interface utilisateur pour les professionnels de santé et les patients.
- **Technologie** : React 18, TypeScript, Vite, TanStack Router, TailwindCSS, Recharts, jsPDF.
- **Port** : `3000`.
- **Routes principales** :
  - `/` : Vue d'ensemble du système, indicateurs clés et statut des nœuds.
  - `/diagnostic` : Console interactive de triage radiologique (upload, choix du contexte, forçage de routage, visualisation du chemin d'exécution et des escalades).
  - `/monitoring` : Tableau de bord de télémétrie temps réel (gauges CPU/RAM, graphes de latence, charge des nœuds).
  - `/historique` : Journal persistant des analyses avec filtrage et inspection détaillée.
  - `/patients` : Gestion des dossiers patients anonymisés, upload de clichés et validation médicale.
  - `/resultat` : Portail public patient (saisie de l'OTP, consultation vulgarisée et téléchargement du compte rendu PDF).
- **Dépendances** : Consomme l'API du `moteur-decision` via `/api` (ou `http://localhost:8003`).
- **Points d'attention** : Génération du PDF 100% côté client via `jsPDF` dans `src/lib/export-pdf.ts`. Deux formats distincts : PDF clinique complet (médecins) et PDF vulgarisé (patient).

---

## 3. CŒUR MÉTIER — MOTEUR DE DÉCISION

### 3.1 Algorithme de routage étape par étape

```
                      [ RADIOGRAPHIE REÇUE ]
                                 │
                                 ├──────────────────────────────┐
                                 ▼                              ▼
                    [ PROFILAGE D'IMAGE (Pillow) ]     [ TÉLÉMÉTRIE SYSTÈME ]
                    - Format (PNG / JPEG)              - Ping Cloud (/sante) -> Latence
                    - Dimensions & Ratio L/H           - Psutil Edge -> CPU %, RAM %
                    - Canaux (RGB / Grayscale)         - Disponibilité réseau (bool)
                                 │                              │
                                 ▼                              ▼
                    [ SÉLECTION DES MODÈLES ]          [ ARBRE DE DÉCISION ]
                    - PNG carré -> TB seul             1. Réseau KO ? ---------> EDGE
                    - JPEG étiré -> PN seul            2. Latence > 100ms ? ---> EDGE
                    - Ambigu/Général -> TB + PN        3. CPU Edge > 80% ? ----> CLOUD
                    - Forcé par soignant               4. RAM Edge > 85% ? ----> CLOUD
                                 │                     5. Défaut --------------> EDGE
                                 │                              │
                                 └──────────────┬───────────────┘
                                                │
                                                ▼
                                   [ EXÉCUTION PARALLÈLE ]
                                   Appel HTTP vers TB et/ou PN
                                   (Source: Edge ou Cloud retenue)
                                                │
                                                ▼
                                    [ CONTRÔLE QUALITÉ ]
                               Pour chaque résultat retourné :
                         Confiance < 75% (seuil_escalade) ?
                                      │
                         ┌────────────┴────────────┐
                         ▼ OUI                     ▼ NON
                [ ESCALADE ACTIVÉE ]        [ VERDICT VALIDÉ ]
                Appel du modèle sur
                la source alternative
                (Edge <-> Cloud)
                         │
                         ▼
                [ ARBITRAGE DES AVIS ]
                Avis au score le plus
                élevé conservé.
                Si confiance < 60% :
                Verdit marqué 'indéterminé'
                                 │
                                 ▼
                     [ PERSISTANCE POSTGRESQL ]
                     Envoi asynchrone dans le worker
                     (Table diagnostics + résultats)
```

### 3.2 Seuils de décision actuels et justifications

| Seuil | Valeur par défaut | Justification technique |
|---|---|---|
| `SEUIL_LATENCE_MS` | `100.0 ms` | Au-delà de 100 ms de latence réseau vers le Cloud, le temps de transfert de l'image (2 à 10 Mo) dépasse le temps d'inférence locale Edge. Le traitement local redevient plus rapide. |
| `SEUIL_CPU` | `80.0 %` | Seuil de saturation du processeur Edge. Évite l'engorgement du nœud local et préserve la réactivité du système d'exploitation embarqué. |
| `SEUIL_RAM` | `85.0 %` | Limite critique d'occupation mémoire sur l'Edge (alloué à 512 Mo dans Docker). Prévient les erreurs *Out-Of-Memory* (OOM Kill). |
| `SEUIL_CONFIANCE_ESCALADE` | `0.75` (75%) | Seuil de doute clinique. Si un modèle (Edge ou Cloud) renvoie une probabilité inférieure à 75%, un second avis est systématiquement demandé au nœud opposé. |
| `SEUIL_CONFIANCE_INDETERMINE` | `0.60` (60%) | Seuil d'ambiguïté clinique. Si après arbitrage des deux sources la confiance reste sous 60%, l'examen est marqué `indetermine: true` pour exiger une relecture humaine prioritaire. |
| `SEUIL_RATIO_CARRE` | `[0.9, 1.1]` | Identifie les clichés du jeu Shenzhen/Montgomery (dépistage TB, format PNG carré). |
| `SEUIL_RATIO_PN` | `>= 1.1` | Identifie les clichés du jeu Kaggle Kermany (dépistage PN, format JPEG rectangulaire étiré). |

### 3.3 Métriques utilisées et sources
- **Latence Cloud** : Mesurée par requête HTTP `GET /sante` vers le service Tuberculose Cloud avec timeout strict de 2 secondes.
- **CPU & RAM Edge** : Récupérés par appel HTTP `GET /metriques-systeme` vers le service TB Edge (qui interroge `psutil.cpu_percent()` et `psutil.virtual_memory()`).
- **Disque Edge** : Récupéré via `psutil.disk_usage("/")`.

### 3.4 Ce qui est générique vs spécifique au cas médical
- **Composants Génériques (Architecture Système Réutilisable)** :
  - L'orchestrateur adaptatif par seuils hiérarchiques.
  - Le système de contrôle qualité bi-directionnel (escalade et arbitrage multi-nœuds).
  - La persistance asynchrone non-bloquante avec réhydratation automatique de mémoire.
  - Le tunneling public avec résilience à la mise en veille.
- **Composants Spécifiques au Médical (AERIS)** :
  - Le profilage morphologique des images radiologiques (formats PNG/JPEG, ratios thoraciques).
  - La gestion des pathologies Tuberculose et Pneumonie.
  - Le portail d'approbation médecin et d'accès patient par OTP avec génération de compte rendu médical.

---

## 4. RÈGLES DE DÉVELOPPEMENT À RESPECTER

### 4.1 Style de code
- **Langue** : Nomenclature en **FRANÇAIS** pour toutes les variables, fonctions, tables et fichiers créés (ex. `decider_destination`, `resultats_pathologiques`, `seuil_latence_ms`). Exceptions : fichiers imposés par l'écosystème (`Dockerfile`, `package.json`, etc.).
- **Python** :
  - Python 3.11+.
  - Type hints stricts et obligatoires sur tous les paramètres et retours de fonction.
  - Longueur maximale de ligne : **100 caractères** (formaté via `black` et `ruff`).
  - Docstrings et commentaires rédigés en français.
  ```python
  # Exemple conforme tiré de evaluateur_reseau.py :
  async def verifier_connectivite_cloud() -> bool:
      """Verifie si les services Cloud sont joignables."""
      try:
          async with httpx.AsyncClient(timeout=TIMEOUT_PING) as client:
              reponse = await client.get(f"{config.url_service_tb_cloud}/sante")
              return reponse.status_code == 200
      except Exception:
          return False
  ```
- **TypeScript / React** :
  - `strict: true` dans `tsconfig.json`.
  - Composants fonctionnels avec hooks React natifs.
  - Typage explicite des props et des retours d'API.

### 4.2 Format des réponses API

Toutes les réponses de routage et de diagnostic respectent le schéma unifié `ReponseRoutage` :
```json
{
  "decision": {
    "destination": "edge",
    "raison": "Conditions normales - traitement local privilegie — Ciblage tuberculose, specialiste unique.",
    "metriques": {
      "cpu_pourcentage": 12.4,
      "ram_pourcentage": 48.2,
      "latence_reseau_ms": 14.5,
      "reseau_disponible": true
    }
  },
  "resultats": [
    {
      "pathologie": "tuberculose",
      "prediction": "positif",
      "confiance": 0.9412,
      "temps_inference_ms": 184.2,
      "source": "edge",
      "escalade": false,
      "confiance_initiale": null,
      "source_initiale": null,
      "indetermine": false
    }
  ],
  "escalades": [],
  "temps_total_ms": 215.8,
  "temps_escalade_ms": null,
  "filtrage": {
    "profil": {
      "format": "PNG",
      "largeur_px": 512,
      "hauteur_px": 512,
      "ratio_largeur_hauteur": 1.0,
      "mode_canaux": "RGB",
      "taille_octets": 145200,
      "indecodable": false
    },
    "specialistes_admissibles": ["tuberculose"],
    "regle_appliquee": "Profil tuberculose (PNG carre)",
    "cle_regle": "profil_tb",
    "specialiste_ecarte": "pneumonie",
    "raison": "Format PNG, carre (ratio 1.00) -> profil de depistage tuberculose..."
  }
}
```

### 4.3 Gestion des erreurs
- **Principe de dégradation gracieuse** : Aucune panne d'un composant secondaire ne doit faire crasher l'orchestrateur.
- Si PostgreSQL est indisponible -> le moteur continue en mémoire vive (`registre_diagnostics`).
- Si le Cloud est indisponible -> bascule automatique sur l'Edge.
- Si un service IA échoue -> retour d'un objet `ResultatDiagnostic` avec `prediction: "erreur"` et `confiance: 0.0` sans lever de HTTP 500 non gérée.

### 4.4 Ce qui est STRICTEMENT INTERDIT
1. ❌ **Données nominatives de patients en base** : La table `patients` ne stocke jamais de nom, prénom ou date de naissance exacte (uniquement `code_patient` anonyme opaque et `annee_naissance`).
2. ❌ **Écriture synchrone bloquante en base dans la boucle d'inférence** : Les insertions SQL doivent toujours passer par la file asynchrone `deque` de `persistance.py`.
3. ❌ **Import direct de TensorFlow au niveau racine du moteur de décision** : Le moteur de décision ne fait aucun calcul tensoriel ; il délègue par HTTP.
4. ❌ **Hardcoding d'URLs absolues dans le frontend React** : Utiliser impérativement la variable d'environnement relative `VITE_URL_API_PUBLIQUE=/api`.
5. ❌ **Stockage des codes OTP en clair** : Toujours hacher en SHA-256 avant stockage SQL.

---

## 5. ÉTAT ACTUEL DU PROJET

### 5.1 Ce qui fonctionne parfaitement ✓
- **Pipeline d'inférence complet** : Les 4 modèles d'IA (TB Edge, TB Cloud, PN Edge, PN Cloud) s'exécutent correctement sur leurs conteneurs respectifs.
- **Routage adaptatif temps réel** : Prise de décision dynamique (Edge vs Cloud) basée sur la télémétrie réelle et les seuils configurés.
- **Profilage d'image & routage sélectif (ADR-0002)** : Détection instantanée des caractéristiques de l'image (PNG/JPEG/ratio) évitant les faux positifs croisés.
- **Filet de sécurité & Escalade bi-directionnelle** : Déclenchement automatique d'un second avis sur le nœud opposé si la confiance est < 75%, avec arbitrage au score maximal.
- **Persistance PostgreSQL & Dégradation propre (ADR-0003)** : Schéma relationnel 3NF, file d'attente asynchrone non-bloquante, réhydratation au démarrage.
- **Authentification & Contrôle d'accès RBAC** : JWT sécurisé pour les soignants (`admin`, `medecin`, `technicien`).
- **Canal de notification Patient OTP** : Génération cryptographique de l'OTP, envoi par Email (SMTP/Gmail) et WhatsApp (via `relay-whatsapp` Puppeteer), validation patient et génération de compte rendu PDF client.
- **Exposition publique permanente (ADR-0004)** : Tailscale Funnel configuré avec persistance systemd et restauration automatique après mise en veille.
- **Suites de tests unitaires et d'intégration** : 8 tests pytest sur le moteur de décision, 3 tests par service IA, 8 tests sur WhatsApp.

### 5.2 Ce qui est incomplet ou manquant ✗
- **Exécution effective des expérimentations** : Terminée. Les résultats sont documentés dans `experimentations/resultats/`.
- **Tests automatisés sur le frontend React** : Aucun framework de test (Vitest / Jest / Playwright) n'est configuré dans `tableau-de-bord/`.
- **Tests unitaires dans `relay-whatsapp`** : Aucun test JavaScript automatisé dans le service relais WhatsApp.

### 5.3 Dette technique identifiée ⚠
- **Dépendance inutilisée dans le relais WhatsApp** : `package.json` de `relay-whatsapp` inclut `"pino": "^9.7.0"` alors que `src/serveur.js` utilise `console.log`.
- **Absence d'authentification sur le port interne du relais WhatsApp** : Le port 3500 ne vérifie pas de token d'API interne partagé (`X-Relay-Secret`).
- **Politique de rétention de la télémétrie SQL** : La table `telemetrie_observations` enregistre chaque cycle de mesure sans purge automatique des données anciennes (à surveiller sur le long terme).
- **Arg build frontend vs Docker cache** : La variable `VITE_URL_API_BUILD` est fixée lors du `docker compose build`. Une modification de domaine nécessite de rebuilder sans cache.

### 5.4 Incohérences et anomalies mineures remarquées 🐛
- **Seuils inversés sur le modèle Pneumonie Edge** : Documenté mais non intuitif (`score < 0.5` = positif sur Edge, `>= 0.5` = positif sur Cloud). Bien encapsulé dans `inference.py`.
- **Écart de valeur sur le seed SQL de configuration** : `05-seed.sql` insère `seuil_cpu = 75` par défaut dans la base, alors que `docker-compose.yml` et `.env.example` utilisent `SEUIL_CPU=80`.
- **Commentaires résiduels "Baileys"** : Certains fichiers mentionnent encore Baileys alors que la version active utilise `whatsapp-web.js` (Puppeteer).
- **Affichage des ports dans `demarrage.sh`** : Le script affiche les ports Cloud (`8001`, `8002`) même lorsque le profil `edge` seul est démarré (`8011`, `8012`).

---

## 6. NIVEAU D'INGÉNIOSITÉ ATTENDU

### 6.1 Niveau de complexité du code existant
Le projet dépasse le cadre d'un simple prototype académique grâce à une ingénierie logicielle soignée :
1. **Architecture résiliente et non-bloquante** : L'utilisation conjointe de files asynchrones (`deque`), de coroutines `asyncio.gather`, et de timeouts stricts sur tous les flux réseau garantit qu'aucune panne partielle ne bloque le système.
2. **Double filet de sécurité (Profilage + Escalade)** : Résolution élégante du problème des faux positifs d'IA par inspection des en-têtes d'images (~1 ms) couplée à un mécanisme d'escalade d'arbitrage distribué.
3. **Persistance dégradable** : Capacité du système à fonctionner sans base de données tout en offrant une persistance 3NF complète avec réhydratation automatique lorsqu'elle est présente.

### 6.2 Ce que signifie "faire du bon travail" sur ce projet
- **Respect absolu du typage** : Annotations strictes en Python (`type hints`) et TypeScript (`strict: true`).
- **Traçabilité totale** : Chaque décision prise par le système doit être justifiée dans la réponse JSON (`raison`, `metriques`, `evenements_escalade`, `filtrage`).
- **Documentation systématique** : Rédiger une décision d'architecture (ADR) dans `documentation/journal-decisions/` pour tout choix technique structurant.
- **Isolement et Portabilité** : Toute nouvelle fonctionnalité doit fonctionner dans Docker sans dépendre de chemins absolus de la machine hôte.

---

## 7. FICHIERS CRITIQUES

| Fichier | Rôle & Importance |
|---|---|
| `/home/niang/Documents/EdgeCloud_AI/services/moteur-decision/app/logique_routage/selecteur_edge_cloud.py` | **Cœur névralgique de l'algorithme** : collecte les métriques, applique l'arbre de décision, déclenche le profilage, orchestre les appels d'inférence parallèles et gère l'escalade / arbitrage. |
| `/home/niang/Documents/EdgeCloud_AI/services/moteur-decision/app/logique_routage/profil_image.py` | **Routage sélectif** : extrait les métadonnées de l'image (format, ratio) et filtre les spécialistes admissibles pour éliminer la réactivité croisée hors-domaine. |
| `/home/niang/Documents/EdgeCloud_AI/services/moteur-decision/app/persistance.py` | **Couche de données résiliente** : file d'attente asynchrone SQLAlchemy 2.0, réhydratation de la mémoire vive et persistance 3NF tolérante aux pannes. |
| `/home/niang/Documents/EdgeCloud_AI/services/service-tuberculose/app/coeur/inference.py` | **Moteur d'inférence Tuberculose** : chargement lazy des modèles Keras, prétraitement z-score/rescale et interprétation Softmax/Sigmoïde. |
| `/home/niang/Documents/EdgeCloud_AI/services/service-pneumonie/app/coeur/inference.py` | **Moteur d'inférence Pneumonie** : gestion du canal unique Grayscale en Edge et inversion des seuils de décision. |
| `/home/niang/Documents/EdgeCloud_AI/services/relay-whatsapp/src/serveur.js` | **Relais WhatsApp** : gestion du cycle de vie Chromium headless, affichage du QR code terminal et transmission des OTPs. |
| `/home/niang/Documents/EdgeCloud_AI/tableau-de-bord/src/lib/export-pdf.ts` | **Génération PDF client** : composition vectorielle des comptes rendus cliniques complets et des attestations vulgarisées pour les patients. |
| `/home/niang/Documents/EdgeCloud_AI/docker-compose.yml` | **Orchestration générale** : définition des 8 conteneurs, profils de lancement, limites matérielles CPU/RAM Edge et volumes persistants. |

---

## 8. FLUX COMPLETS DE BOUT EN BOUT

### 8.1 Flux Diagnostic (Radiographie → Résultat enrichi)
1. **Soumission** : Le clinicien téléverse un cliché (PNG/JPEG) sur le tableau de bord (`/diagnostic`).
2. **Ingestion** : Le `moteur-decision` reçoit le flux multipart sur `POST /routage/analyser`.
3. **Profilage** : `profil_image.py` inspecte l'en-tête du fichier via Pillow (dimensions, ratio, format) et identifie le ou les spécialistes requis (ex. PNG carré -> TB).
4. **Sondage Télémétrique** : Le moteur interroge l'état local (`evaluateur_ressources.py`) et la connectivité Cloud (`evaluateur_reseau.py`).
5. **Routage Primaire** : L'arbre de décision sélectionne `edge` ou `cloud`.
6. **Inférence Parallèle** : Requête HTTP asynchrone vers les services IA retenus.
7. **Contrôle Qualité (Filet de confiance)** : Si un verdict a une confiance < 75%, le moteur interroge la source opposée, compare les scores et conserve le plus confiant.
8. **Persistance Asynchrone** : Le résultat complet est poussé dans la file d'attente PostgreSQL en tâche de fond.
9. **Restitution** : La réponse JSON enrichie est affichée au clinicien sur le tableau de bord avec les jauges de confiance et le schéma du routage.

### 8.2 Flux Patient WhatsApp & Consultation du Compte Rendu
1. **Validation Clinique** : Le médecin valide l'examen sur l'onglet `/patients` via `POST /admin/examens/{id}/approuver`.
2. **Génération OTP** : `otp.py` génère un code sécurisé à 6 chiffres (`secrets.choice`), calcule son empreinte SHA-256 et l'enregistre en base avec un TTL de 15 minutes.
3. **Transmission Multicanal** :
   - Si téléphone renseigné -> Requête HTTP vers `relay-whatsapp:3500/envoyer` avec le message formaté et le lien personnalisé : `https://<domaine>/resultat?otp=XXXXXX`.
   - Si email renseigné -> Envoi d'un courriel transactionnel formaté via SMTP.
4. **Réception & Connexion** : Le patient clique sur le lien ou saisit son numéro et son OTP sur le portail `/resultat`.
5. **Vérification** : Le backend vérifie l'empreinte SHA-256, la validité temporelle (< 15 min), le nombre de tentatives (< 5) et marque l'OTP comme consommé (`utilise_le = now()`).
6. **Affichage & Export PDF** : L'interface restitue le compte rendu simplifié et permet le téléchargement immédiat du PDF sécurisé avec la marque AERIS.

---

## 9. CE QU'IL NE FAUT PAS TOUCHER

1. **La logique d'inversion des seuils dans `service-pneumonie/app/coeur/inference.py`** : Cette logique est mathématiquement calée sur les poids des modèles `.h5` actuels. La modifier inverserait les diagnostics sains et pathologiques.
2. **Le mécanisme de routage par chemin de Tailscale Funnel dans `assurer-tunnel.sh`** : L'utilisation des drapeaux `--set-path=/` et `--set-path=/api` évite la boucle de redirection HTTP 502.
3. **Le découplage asynchrone de `persistance.py`** : La file d'attente `deque` protège le pipeline d'inférence contre les ralentissements de la base de données.
4. **Le nettoyage des verrous Chromium dans `relay-whatsapp/src/serveur.js`** : La fonction `deverrouillerProfil()` est essentielle pour empêcher les crashs de conteneur après un redémarrage impromptu.

---

## 10. PROCHAINES ÉTAPES IDENTIFIÉES

1. **Exécution et consolidation de la campagne expérimentale** :
   - Lancer les 4 scénarios scriptés dans `experimentations/` (`scenario-tout-cloud`, `scenario-tout-edge`, `scenario-adaptatif`, `scenario-panne`).
   - Générer les fichiers CSV de résultats et exécuter `analyseur_resultats.py` pour produire les rapports statistiques comparatifs destinés au mémoire.
2. **Sécurisation de l'API interne du relais WhatsApp** :
   - Mettre en place un header secret partagé (`X-Relay-Secret`) entre le moteur de décision et le conteneur `relay-whatsapp`.
3. **Harmonisation des valeurs par défaut de configuration** :
   - Aligner le seuil CPU initial dans `05-seed.sql` sur la valeur standard de 80%.
4. **Ajout d'une suite de tests frontend** :
   - Configurer Vitest et React Testing Library pour tester les flux critiques du tableau de bord (saisie OTP, affichage diagnostic).

---
*Ce document constitue le référentiel technique exhaustif et fidèle de l'architecture AERIS.*
