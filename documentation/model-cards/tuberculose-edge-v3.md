# Model card — Tuberculose Edge v3 (`tb_edge_v3`)

> Les chiffres de cette page sont **mesurés**, pas estimés. Source :
> `sauvegardes/modeles-v3/metrics_tb_edge_v3.json`, produit par le notebook
> `kernels/kaggle/tb-edge-v3/tb-edge-v3.ipynb`.
> **Ce modèle est en service** : `services/service-tuberculose/modeles_entraines/modele_tuberculose.h5`.
> La marche arrière vers v1 est documentée dans `sauvegardes/LISEZ-MOI.md`.

## Entraînement

| Champ | Valeur |
|---|---|
| Architecture | CNN séquentielle, **identique à v1** : 3 blocs de 3 × Conv2D 32/64/128 (3×3, ReLU) + MaxPool + Dropout 0,3, Flatten, Dense 256 (ReLU), Dropout 0,3, Dense 2 (`softmax`) |
| Entrée | 96 × 96, 3 canaux (RGB), normalisée `[0 ; 1]` (`rescale`) |
| Tête | softmax 2 classes — colonne 1 = **P(tuberculose)** |
| Optimisation | Adam 5e-4, `sparse_categorical_crossentropy`, batch 32 |
| Augmentation | PIL (`augmenter_pil`) : miroir/flip, rotation ±10°, recadrage 0,90–1,00, luminosité/contraste ±10 % — **mise en cache** (voir limite n° 1) |
| Arrêt | `EarlyStopping` sur `val_loss`, patience 12 ; `ReduceLROnPlateau` (facteur 0,5, patience 5) |
| Epochs effectifs | **60** (plafond atteint) |
| Graine | 42 |
| Dataset | `Tawsifurrahman` — TB Chest Radiography Database (Shenzhen + Montgomery) |
| Split | dédupliqué par **SHA-256 de contenu**, 80/10/10 par classe : train 3357 / val 420 / **test 420** |
| Pool d'évaluation | 420 images, 70 positives (prévalence 0,167) |
| Notebook | `kernels/kaggle/tb-edge-v3/tb-edge-v3.ipynb` |

Le lot `test` a été dédupliqué par contenu (**0 doublon inter-lots**), ce qui
lève la fuite stricte `Tuberculosis-243`/`244` identifiée dans l'étude v2.

## Performances brutes (hold-out, 420 images)

| Métrique | Valeur |
|---|---|
| AUC | **0.99976** |
| Brier | **0.00531** |
| NLL | **0.02682** |
| Saturation float32 (seuil 1e-6) | 31 |
| Afficheraient « 100 % » (arrondi) | 31 / 420 |

## Calibration

| Métrique | Avant | Après | Écart |
|---|---|---|---|
| Brier | 0.00531 | **0,01876** | −0,00019 |
| NLL | 0.02682 | **0,06643** | −0,00808 |

| Paramètre | Valeur |
|---|---|
| Diagnostic | `estimable` |
| Correction retenue | `temperature_scaling`, **T = 0,7009** |
| Plafond | **0,995** (partagé avec `tableau-de-bord/src/lib/format.ts`) |
| Affichent « 100 % » après correction | **0** |

Comme pour la pneumonie Edge, T < 1 renforce les probabilités avant plafond. Les
31 valeurs qui saturaient à 100 % en brut sont ramenées à 0,995.

## Point opératoire (rappel cible 0,90)

| Seuil | Rappel | Précision | Spécificité |
|---|---|---|---|
| 0,3458 (brut) | 0,9000 | 0,9545 | 0,9914 |
| 0,2871 (calibré) | 0,9000 | 0,9545 | 0,9914 |

Sur 420 images : **3 faux positifs, 7 faux négatifs** au point 0,90.

## Comparaison avec v1 (même hold-out dédupliqué)

| | AUC | Brier | NLL | précision au rappel 0,90 |
|---|---|---|---|---|
| v1 (ancien modèle) | 0,74980 | 0,19724 | 0,59045 | 0,2136 |
| **v3 (en service)** | **0.99976** | **0.00531** | **0.02682** | **0,9545** |

Le critère de remplacement est satisfait sur les **quatre** axes
(`{auc: oui, brier: oui, nll: oui, point_090_binaire: oui}`). v1, sur ce
hold-out dédupliqué, classait 232 faux positifs au rappel 0,90 ; v3 en classe 3.
**C'est le gain le plus net des deux pathologies.**

## Limites — à lire avant toute réutilisation

1. **L'augmentation est mise en cache : la même image augmentée est revue à
   chaque epoch.** Le notebook TB v3 utilise `augmenter_pil(..., SEED + indice)`
   **suivi de `.cache()`** dans le pipeline d'entraînement — exactement le défaut
   corrigé côté pneumonie (où l'augmentation est désormais appliquée par epoch,
   sans cache). L'effet reste positif ici (AUC 0,9998, tous les critères
   satisfaits), mais **le modèle TB n'a pas bénéficié du correctif** : il est
   entraîné sur une version figée par image. Une reprise avec augmentation par
   epoch est la suite logique ; elle n'est pas faite et n'a pas été validée.
2. **34 prédictions saturaient à 100 %.** Contrairement à v2, v3 sature encore un
   peu en float32 ; la calibration + plafond les ramène à 0,995. C'est borné,
   mais cela signifie que ces 34 images ne sont pas distinguables entre elles par
   la logique d'escalade.
3. **7 faux négatifs au rappel 0,90.** Sur 70 positifs, 7 sont manqués. La
   spécificité (0,9914) est excellente, mais un faux négatif de tuberculose est
   le risque clinique le plus grave : aucun déploiement sans revue radiologique.
4. **Binaire, mono-label.** Aucune information sur la pneumonie. Le croisement
   TB × PN reste non résolu.
5. **Pas de validation externe.** Hold-out dédupliqué mais issu du même corpus
   (Shenzhen + Montgomery). Aucune généralisation établie.
6. **60 epochs sans early stopping effectif.**

## Traçabilité

| Artefact | Chemin |
|---|---|
| Modèle déployé | `services/service-tuberculose/modeles_entraines/modele_tuberculose.h5` (gitignoré) |
| Modèle archivé | `sauvegardes/modeles-v3/aeris_tb_edge_v3.h5` / `.keras` |
| Prédictions test | `sauvegardes/modeles-v3/predictions_test_tb_edge_v3.csv` |
| Métriques | `sauvegardes/modeles-v3/metrics_tb_edge_v3.json` |
| Notebook | `kernels/kaggle/tb-edge-v3/tb-edge-v3.ipynb` |
| Calibration en service | `services/service-tuberculose/app/coeur/inference.py` (`TEMPERATURE_EDGE = 0,7009`) |

Les `.h5`/`.keras` sont ignorés par `.gitignore` (règle « modèles non
versionnés ») : présents sur disque, non suivis par Git.

## Version du notebook (run6 — augmentation corrigée)

Le modèle actuel a été réentraîné avec `RandomBrightness(0.10, value_range=(0.0,1.0))`, `clipnorm=1.0`, `patience=20`, `monitor='val_loss'` (early stopping conservateur). Le correctif supprime le biais (sorties ~8–26) identifié sous tf_keras 2.20. Voir `kernels/kaggle/tb-edge-v3/tb-edge-v3.ipynb` (version pushée) et sauvegarde `tb-edge-v3_run6/`.

## Attribution

Dataset de radiographies thoraciques tuberculeuses : Tawsifurrahman et al.,
*IEEE Access*, 2020, DOI [10.1109/ACCESS.2020.3031384](https://doi.org/10.1109/ACCESS.2020.3031384).
Modèle entraîné par AERIS ; ces résultats couvrent la recherche du projet, pas un
usage clinique.
