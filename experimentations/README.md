# Experimentations

Scenarios comparatifs pour evaluer le comportement du moteur de decision AERIS
sous differentes conditions de charge et de connectivite.

## Scenarios

| Scenario | Mode | Description |
|----------|------|-------------|
| `scenario-tout-cloud/` | Force | Envoi systematique au Cloud — vulnerabilite reseau |
| `scenario-tout-edge/` | Force | Traitement 100% local — risque de saturation |
| `scenario-adaptatif/` | Dynamique | Routage adaptatif sous charges variables |
| `scenario-panne/` | Dynamique | Verification de la bascule automatique lors d'une panne Edge |

## Profils de charge

| Profil | Effet |
|--------|-------|
| `stable` | Aucune degradation (baseline) |
| `reseau_lent` | Latence reseau elevee vers le Cloud |
| `reseau_coupure` | Coupure temporaire du reseau Cloud |
| `cpu_sature` | CPU Edge sature via stress-ng |
| `panne_edge` | Service Edge indisponible (arret Docker) |

## Pre-requis

1. Tous les services Docker actifs :
   ```bash
   docker compose --profile complet up -d
   ```
2. Les modeles `.h5` presents dans `modeles_entraines/`
3. Les images de test dans `donnees/test-tuberculose/` et `donnees/test-pneumonie/`
4. Python 3.11+ avec `requests`, `httpx`, `pandas`

## Execution

```bash
# Depuis la racine du projet
python experimentations/scenario-tout-cloud/executer.py
python experimentations/scenario-tout-edge/executer.py
python experimentations/scenario-adaptatif/executer.py
python experimentations/scenario-panne/executer.py
```

## Resultats

Les resultats sont generes dans `resultats/<scenario>/` :
- `resultats-bruts.csv` — donnees brutes de chaque soumission
- `statistiques.json` — statistiques agregees (moyenne, mediane, P95, etc.)
- `rapport.txt` — rapport textuel lisible

Le tableau comparatif entre tous les scenarios est dans `resultats/comparaison/`.

## Modules communs

| Module | Role |
|--------|------|
| `communs/prepareur_images.py` | Chargement et preparation du jeu de test |
| `communs/collecteur_metriques.py` | Soumission HTTP et collecte de metriques |
| `communs/generateur_charge.py` | Simulation de charges variables (Docker) |
| `communs/analyseur_resultats.py` | Statistiques, rapports et comparaison |

## Limites methodologiques

Le jeu de demonstration utilise 10 images par pathologie (20 au total).
Les resultats montrent le comportement architectural du systeme mais ne
constituent pas une evaluation clinique de la precision des modeles.
Pour une evaluation publication, un echantillon de 100+ images par classe
serait necessaire.
