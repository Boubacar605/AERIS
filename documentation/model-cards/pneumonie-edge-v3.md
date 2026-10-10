# Model card — Pneumonie Edge v3 (`pn_edge_v3`)

> Les chiffres de cette page sont **mesurés**, pas estimés. Source :
> `sauvegardes/modeles-v3/metrics_pn_edge_v3.json`, produit par le notebook
> `kernels/kaggle/pn-edge-v3/pn-edge-v3.ipynb`.
> **Ce modèle est en service** : `services/service-pneumonie/modeles_entraines/modele_pneumonie.h5`.
> La marche arrière vers v1 est documentée dans `sauvegardes/LISEZ-MOI.md`.

## Entraînement

| Champ | Valeur |
|---|---|
| Architecture | CNN séquentielle, **identique à v1** : 5 blocs Conv2D 32/64/64/128/256 (3×3, ReLU) + BatchNorm + MaxPool, Dropout 0,1–0,2, Flatten, Dense 128 (ReLU), Dropout 0,2, Dense 1 (`sigmoid`) |
| Entrée | 150 × 150, 1 canal (niveaux de gris), normalisée `[0 ; 1]` (`rescale`) |
| Tête | Dense 1, `sigmoid` — la sortie **est** P(PNEUMONIE) |
| Optimisation | Adam 5e-4, `binary_crossentropy`, batch 32 |
| Augmentation | Couches Keras **appliquées à chaque epoch** (aucun cache) : `RandomFlip` H et V, `RandomRotation` ±10°, `RandomZoom` 0,10, `RandomBrightness` 0,10, `RandomContrast` 0,10 |
| Arrêt | `EarlyStopping` sur `val_auc`, patience 15 ; `ReduceLROnPlateau` (facteur 0,5, patience 6) |
| Epochs effectifs | **60** (plafond atteint : `val_auc` croissait encore) |
| Graine | 42 (`random`, `numpy`, `tensorflow`) |
| Dataset | `paultimothymooney/chest-xray-pneumonia` (Mooney / Kermany et al.) |
| Split | dédupliqué par **SHA-256 de contenu**, 80/10/10 par classe : train 4658 / val 583 / **test 583** |
| Pool d'évaluation | 583 images, 425 positives (prévalence 0,729) |
| Notebook | `kernels/kaggle/pn-edge-v3/pn-edge-v3.ipynb` |

Le lot `test` n'a servi ni à l'entraînement ni au choix d'epoch (sélection sur
`val`). Il a été dédupliqué par contenu : **0 doublon inter-lots**, contrairement
au split natif Mooney des études v1 où `Tuberculosis-243`/`244` se recoupaient.

**Correctif clé par rapport à `pn_edge_v2` (et v18).** Dans v2/18, `.cache()`
était placé **avant** `.batch()` sur une source déjà augmentée : la même image
augmentée était donc revue à chaque epoch, d'où un surapprentissage dès
l'epoch 4. v3 augmente **par epoch** (couches Keras, sans cache) — c'est le
changement qui a fait passer le modèle d'une AUC 0,82/0,98 tronquée à 0,977
stable.

## Performances brutes (hold-out, 583 images)

| Métrique | Valeur |
|---|---|
| AUC | **0,97736** |
| Brier | **0,05150** |
| NLL | **0,18074** |
| Saturation float32 (seuil 1e-6) | **0** |
| Afficheraient « 100 % » (arrondi) | 139 / 583 |

## Calibration

| Métrique | Avant | Après | Écart |
|---|---|---|---|
| Brier | 0,05150 | **0,05021** | −0,00128 |
| NLL | 0,18074 | **0,17497** | −0,00577 |

| Paramètre | Valeur |
|---|---|
| Diagnostic | `estimable` |
| Correction retenue | `temperature_scaling`, **T = 0,7748** |
| Plafond | **0,995** (partagé avec `tableau-de-bord/src/lib/format.ts`) |
| Affichent « 100 % » après correction | **0** |

**T < 1 : la calibration renforce, elle n'adoucit pas.** Sur ce modèle, la
température qui minimise la NLL est inférieure à 1, donc les probabilités
s'éloignent de 0,5 avant d'être plafonnées à 0,995. Conséquence visible : de
nombreuses prédictions fortes se collent à 0,995. C'est attendu et borné — la
valeur 0,995 est un plafond explicite, jamais 1,0. Voir la limite n° 1.

La borne est appliquée **dans le service** (`inference.py`,
`_calibrer_probabilite` + `SEUIL_SATURATION`), pas seulement à l'affichage, et
porte sur la **confiance du verdict** : un négatif dont `P(PNEUMONIE)` est
proche de 0 renvoie `1 − p`, lui aussi plafonné.

## Point opératoire (rappel cible 0,90)

| Seuil | Rappel | Précision | Spécificité |
|---|---|---|---|
| 0,8437 (brut) | 0,9012 | 0,9846 | 0,9620 |
| 0,8981 (calibré) | 0,9012 | 0,9846 | 0,9620 |

Sur 583 images : **6 faux positifs, 42 faux négatifs** au point 0,90.

## Comparaison avec v1 (même hold-out dédupliqué)

| | AUC | Brier | NLL | affichaient « 100 % » |
|---|---|---|---|---|
| **v1 (ancien modèle)** | **0,98648** | 0,07643 | 0,26777 | 214 / 583 |
| **v3 (en service)** | 0,97736 | **0,05150** | **0,18074** | 139 → **0** après plafond |

Le critère de remplacement retenu hors ligne (`remplacements`) est
`{auc: non, brier: oui, nll: oui, point_090_binaire: oui}` :

- **L'AUC globale est un peu plus basse**, mais l'écart n'est pas concluant :
  v1 a mémorisé une grande partie du hold-out (520 des 583 images). Sur les
  **63 images que v1 n'a jamais vues**, les deux modèles sont à égalité
  statistique (AUC v1 0,9653 vs v3 0,9689 ; Δ +0,0036, IC95 [−0,0383 ; +0,0431]).
- **Brier et NLL sont nettement meilleurs**, et le modèle ne sature plus : 0
  valeur à 100 % contre 214 pour v1.

## Limites — à lire avant toute réutilisation

1. **De nombreuses confiances sont exactement 0,995.** C'est le plafond, pas une
   mesure : T < 1 étale les logits forts, et le plafond les tronque. Une valeur à
   0,995 signifie « le modèle est très sûr », pas « 99,5 % de probabilité
   calibrée ». Le plafond interdit le « 100 % », il ne quantifie pas la certitude.
2. **AUC non supérieure à v1 sur le hold-out.** Le gain porte sur la calibration
   (Brier/NLL) et sur la disparition de la saturation, pas sur le classement. Ne
   pas présenter v3 comme un progrès de discrimination.
3. **42 faux négatifs au rappel 0,90.** À ce point de fonctionnement, 42
   radiographies pneumoniques sur 425 sont manquées. Aucun déploiement clinique
   n'est envisageable sans recalibrage du seuil, revue radiologique et corpus de
   vérification externe.
4. **Binaire, mono-label.** Le modèle ne dit rien de la tuberculose. Le
   croisement TB × PN reste non résolu et exige une annotation clinique.
5. **Pas de validation externe.** Le hold-out est dédupliqué mais provient du
   même corpus que l'entraînement (Mooney). Aucune généralisation à un autre
   hôpital, appareil ou population n'est établie.
6. **60 epochs sans early stopping effectif.** `val_auc` croissait encore à
   l'arrêt : le budget était limite. Une reprise n'est ni validée ni exclue.

## Traçabilité

| Artefact | Chemin |
|---|---|
| Modèle déployé | `services/service-pneumonie/modeles_entraines/modele_pneumonie.h5` (gitignoré) |
| Modèle archivé | `sauvegardes/modeles-v3/aeris_pn_edge_v3.h5` / `.keras` |
| Prédictions test | `sauvegardes/modeles-v3/predictions_test_pn_edge_v3.csv` |
| Métriques | `sauvegardes/modeles-v3/metrics_pn_edge_v3.json` |
| Notebook | `kernels/kaggle/pn-edge-v3/pn-edge-v3.ipynb` |
| Calibration en service | `services/service-pneumonie/app/coeur/inference.py` (`TEMPERATURE_EDGE = 0,7748`) |

Les `.h5`/`.keras` sont ignorés par `.gitignore` (règle « modèles non
versionnés ») : présents sur disque, non suivis par Git.

## Attribution

Dataset Mooney (Kermany et al., 2018), via le dataset Kaggle
`paultimothymooney/chest-xray-pneumonia`. Modèle entraîné par AERIS ; ces
résultats couvrent la recherche du projet, pas un usage clinique.
