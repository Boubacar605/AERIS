# AERIS — Architecture Edge-cloud pour la Radiologie Intelligente au Senegal

## Contexte

Memoire de Master 2 Systemes d'Information — Universite Alioune Diop de Bambey (UADB), Senegal.
Presente par Boubacar NIANG — Annee academique 2025-2026.

Application : triage radiologique assiste par IA (tuberculose + pneumonie) en zones a faible connectivite.

## Problematique

Comment concevoir un systeme distribue capable de decider automatiquement de l'execution d'un pipeline d'IA medical sur l'Edge ou dans le Cloud, en fonction de l'etat des ressources et du reseau, tout en gerant la detection de pathologies multiples ?

## Orientation

- Ce n'est PAS un projet de Data Science : l'IA est un composant, pas le sujet
- Le coeur est un PROBLEME DE SYSTEME : architecture, orchestration, deploiement, adaptation
- Le projet doit rester un prototype experimental realiste pour un Master 2
- La contribution est architecturale et experimentale

## Architecture

```
[Radiographie] --> [MOTEUR DE DECISION] --> [EDGE: TB + PN (light)]
                         |              --> [CLOUD: TB + PN (full)]
                         |
                   [MONITORING Prometheus]
                         |
                   [TABLEAU DE BORD React]
```

## Composants

| Composant | Dossier | Role |
|-----------|---------|------|
| Service Tuberculose | `services/service-tuberculose/` | Inference detection TB |
| Service Pneumonie | `services/service-pneumonie/` | Inference detection PN |
| Moteur de Decision | `services/moteur-decision/` | Routage adaptatif Edge/Cloud |
| Tableau de Bord | `tableau-de-bord/` | Interface de triage (React) |
| Monitoring | `infrastructure/prometheus/` | Metriques temps reel |
| Experimentations | `experimentations/` | Scenarios comparatifs |

## Structure des dossiers

```
aeris/
├── services/
│   ├── service-tuberculose/
│   │   ├── app/
│   │   │   ├── principal.py
│   │   │   ├── config.py
│   │   │   ├── routes/ (sante.py, diagnostic.py)
│   │   │   ├── schemas/ (schemas_diagnostic.py)
│   │   │   └── coeur/ (inference.py)
│   │   ├── tests/
│   │   ├── modeles_entraines/ (.gitkeep)
│   │   ├── Dockerfile
│   │   └── requirements.txt
│   ├── service-pneumonie/ (structure miroir)
│   └── moteur-decision/
│       ├── app/
│       │   ├── principal.py
│       │   ├── config.py
│       │   ├── routes/ (sante.py, routage.py)
│       │   ├── schemas/ (schemas_routage.py)
│       │   └── logique_routage/ (evaluateur_reseau.py, evaluateur_ressources.py, selecteur_edge_cloud.py)
│       └── tests/
├── tableau-de-bord/ (React + TypeScript + TailwindCSS)
├── infrastructure/
│   ├── prometheus/prometheus.yml
│   └── scripts/demarrage.sh
├── documentation/
│   ├── architecture.md
│   ├── journal-decisions/
│   └── guide-contribution.md
├── donnees/ (gitignore)
├── carnets-exploration/
├── experimentations/
│   ├── scenario-tout-cloud/
│   ├── scenario-tout-edge/
│   ├── scenario-adaptatif/
│   └── resultats/
├── docker-compose.yml
├── pyproject.toml
└── .env.example
```

## Conventions techniques

- **Nomenclature** : fichiers et dossiers en FRANCAIS (sauf noms imposes par les outils)
- **Services IA** : Python 3.11+, FastAPI, TensorFlow/Keras pour l'inference
- **Moteur de Decision** : Python, FastAPI, regles basees sur seuils configurables
- **Frontend** : React 18 + TypeScript, TailwindCSS, Recharts
- **Monitoring** : Prometheus + prometheus-fastapi-instrumentator
- **Conteneurisation** : Docker, Docker Compose (profils: cloud, edge, complet)
- **Style Python** : type hints, black (100 car), ruff, docstrings en francais
- **Style TypeScript** : strict: true, ESLint, Prettier
- **Commits** : Conventional Commits en francais

## Scenarios experimentaux

| Scenario | Description |
|----------|-------------|
| Tout-Cloud | Envoi systematique au Cloud |
| Tout-Edge | Traitement 100% local |
| Adaptatif | Routage dynamique selon metriques |

## Metriques

- Latence end-to-end (ms)
- Temps d'inference (ms)
- CPU / RAM utilises (%)
- Bande passante reseau
- Debit de traitement (req/s)
- Precision du modele

## Commandes utiles

```bash
# Lancer tout
docker compose --profile complet up -d

# Cloud seul
docker compose --profile cloud up -d

# Edge seul
docker compose --profile edge up -d

# Tableau de bord (dev)
cd tableau-de-bord && npm run dev

# Tests d'un service
cd services/service-tuberculose && pytest tests/ -v
cd services/moteur-decision && pytest tests/ -v
```

## Notes importantes

- Le projet doit fonctionner en demo devant un jury
- Privilegier la stabilite et la reproductibilite
- L'Edge est simule via Docker avec --cpus et --memory
- Les modeles IA sont pre-entraines (CNN Keras, pas d'entrainement from-scratch)
- Deux pathologies : tuberculose (datasets Shenzhen + Montgomery) et pneumonie (Chest X-Ray Kaggle)
