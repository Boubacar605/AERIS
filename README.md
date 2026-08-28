# AERIS

**Architecture Edge-cloud pour la Radiologie Intelligente au Senegal**

> Memoire de Master 2 Systemes d'Information — Universite Alioune Diop de Bambey (UADB), Senegal
> Presente par : Boubacar NIANG — Annee academique 2025-2026

---

## Problematique

Comment concevoir un systeme distribue capable de decider automatiquement de l'execution d'un pipeline d'IA medical sur l'Edge (localement) ou dans le Cloud (a distance), en fonction de l'etat des ressources disponibles et des conditions reseau, tout en gerant simultanement la detection de pathologies multiples ?

## Architecture

```
   Radiographie (X-ray)
         |
         v
  +------+-------+
  | MOTEUR DE    |
  | DECISION     |  <-- Metriques systeme (CPU, RAM, reseau)
  +---+------+---+
      |      |
      v      v
+-----+--+ +-+--------+
|  EDGE   | |  CLOUD   |
|---------|  |----------|
| TB light| | TB full  |
| PN light| | PN full  |
+---------+ +----------+
      |          |
      v          v
  Resultats de diagnostic
         |
         v
  +------+-------+
  | TABLEAU DE   |
  | BORD (React) |
  +--------------+
```

## Services

| Service | Dossier | Role |
|---------|---------|------|
| Service Tuberculose | `services/service-tuberculose/` | Inference IA pour detection de la tuberculose |
| Service Pneumonie | `services/service-pneumonie/` | Inference IA pour detection de la pneumonie |
| Moteur de Decision | `services/moteur-decision/` | Routage adaptatif Edge vs Cloud |
| Tableau de Bord | `tableau-de-bord/` | Interface de triage pour le personnel medical |
| Monitoring | `infrastructure/prometheus/` | Collecte de metriques en temps reel |

## Technologies

| Composant | Technologie |
|-----------|-------------|
| Backend / Services IA | Python 3.11+, FastAPI, ONNX Runtime |
| Moteur de Decision | Python, FastAPI, regles basees sur seuils |
| Frontend | React 18, TypeScript, TailwindCSS, Recharts |
| Conteneurisation | Docker, Docker Compose |
| Monitoring | Prometheus |

## Scenarios experimentaux

| Scenario | Description |
|----------|-------------|
| Tout-Cloud | Envoi systematique au Cloud — vulnerabilite reseau |
| Tout-Edge | Traitement 100% local — risque de saturation |
| Adaptatif | Routage dynamique selon metriques — compromis optimal |

## Demarrage rapide

```bash
# Lancer tous les services
docker compose --profile complet up -d

# Lancer uniquement les services Cloud
docker compose --profile cloud up -d

# Lancer uniquement les services Edge
docker compose --profile edge up -d

# Tableau de bord (developpement)
cd tableau-de-bord && npm run dev
```

## Structure du projet

```
aeris/
├── services/
│   ├── service-tuberculose/    # Inference tuberculose (FastAPI)
│   ├── service-pneumonie/      # Inference pneumonie (FastAPI)
│   └── moteur-decision/        # Routage adaptatif Edge/Cloud
├── tableau-de-bord/            # Dashboard React/TypeScript
├── infrastructure/
│   ├── prometheus/             # Configuration monitoring
│   └── scripts/                # Scripts de lancement
├── documentation/
│   ├── architecture.md         # Schema d'architecture
│   └── journal-decisions/      # Architecture Decision Records
├── donnees/                    # Jeux de donnees (gitignore)
├── carnets-exploration/        # Notebooks Jupyter
└── experimentations/           # Scenarios comparatifs
```

## Metriques evaluees

- Latence end-to-end (ms)
- Temps d'inference (ms)
- Utilisation CPU / RAM (%)
- Bande passante reseau consommee
- Debit de traitement (requetes/seconde)
- Precision du modele (comparaison complet vs optimise)
