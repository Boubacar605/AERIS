# Rapport sur les modèles remplacés à cet instant

Date : 2026-10-10T18:58:19.795128

## 1) État de déploiement Edge v3

| Pathologie | Service | Fichier déployé | AUC v3 (hold-out dédupliqué) | Remplace v1 ? |
|---|---|---|---|---|
| Tuberculose (TB) | service-tuberculose-edge | services/service-tuberculose/modeles_entraines/modele_tuberculose.h5 | 0.9998 | OUI / OUI / OUI / OUI |
| Pneumonie (PN) | service-pneumonie-edge | services/service-pneumonie/modeles_entraines/modele_pneumonie.h5 | 0.9774 | NON / OUI / OUI / OUI |

Légende remplacement : (auc / brier / nll / point_rappel_0.90).

## 2) Comparaison TB v1 vs TB v3 Edge

| Métrique | v1 (référence) | v3 Edge | Gain |
|---|---|---|---|
| AUC | 0.7498 | 0.9998 | +0.2500 |
| Brier | 0.1972 | 0.0053 | -0.1919 |
| NLL | 0.5904 | 0.0268 | -0.5636 |

## 3) Comparaison PN v1 vs PN v3 Edge

| Métrique | v1 (référence) | v3 Edge | Gain |
|---|---|---|---|
| AUC | 0.9865 | 0.9774 | +-0.0091 |
| Brier | 0.0764 | 0.0515 | -0.0249 |
| NLL | 0.2678 | 0.1807 | -0.0870 |

## 4) Traçabilité sauvegardes

| Modèle | H5 | Keras | Métriques |
|---|---|---|---|
| TB Edge v3 | sauvegardes/modeles-v3/aeris_tb_edge_v3.h5 | sauvegardes/modeles-v3/aeris_tb_edge_v3.keras | sauvegardes/modeles-v3/metrics_tb_edge_v3.json |
| PN Edge v3 | sauvegardes/modeles-v3/aeris_pn_edge_v3.h5 | sauvegardes/modeles-v3/aeris_pn_edge_v3.keras | sauvegardes/modeles-v3/metrics_pn_edge_v3.json |

**Note Cloud v1** : conformément à la directive, aucun Cloud v3 n'a été produit. Cloud reste en v1 (avec plafond 0,995 appliqué côté code pour tous les services).

## 5) Tests / vérifications

- Tests moteur : 199 passed
- Tests expérimentations : 87 passed
- Tests IA (PN/TB) : 5 passed / 5 passed
- Frontend : npx tsc --noEmit OK
- ruff/black moteur : nettoyés