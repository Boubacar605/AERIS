# Model card — Tuberculose Edge v2 (`tb_edge_v2`)

> Les chiffres de cette page sont **mesurés**, pas estimés. Source :
> `experimentations/resultats/calibrage/tuberculose_tb_edge_v2_rapport.json`.
> Aucun service de production n'utilise ce modèle : il est évalué hors ligne.

## Entraînement

| Champ | Valeur |
|---|---|
| Architecture | CNN séquentielle légère, entrée 96 × 96 niveaux de gris |
| Tête | Dense 1, `sigmoid` — la sortie **est** la probabilité de tuberculose |
| Pool | `tawsifurrahman/tuberculosis-tb-chest-xray-dataset` |
| Split | déterministe, graine 42 : `train` 3360 / `val` 420 / **`test` 420** |
| Positifs | `train` 560 / `val` 70 / **`test` 75** |
| Pool d'évaluation | 420 images, 75 positives (prévalence 0,1786) |
| Arrêt | cap de 50 epochs atteint, **aucun early stopping déclenché** |
| Epochs effectifs | 50 |
| Entraînement hors ligne | Kaggle `boubaniang/aeris-tb3-edge-96`, version 1 |
| Artefacts | `aeris_tb_edge_96.keras` (352 685 octets) |

Les 4200 références des manifests ont été recoupées avec le listing réel du
dataset sur Kaggle : 3500 `Normal`, 700 `Tuberculosis`, **aucune référence
manquante**. Le découpage est donc reproductible, contrairement à un
`train_test_split` fait sur un listing local.

## Performances brutes (hold-out, 420 images)

| Métrique | Notebook | Analyseur |
|---|---|---|
| AUC | 0,97314 | **0,9731** |
| Brier | 0,017649 | **0,01765** |
| NLL | 0,122516 | **0,12252** |
| ECE (10 tranches) | — | 0,00245 |
| Saturation float32 (seuil 1e-6) | 0 | — |

Les deux sources concordent : la NLL du notebook et celle de l'analyseur
coïncident à la cinquième décimale. Aucune valeur n'est tronquée par
l'adaptation (voir « Précision », plus bas).

## Calibration — résultat contre-intuitif : **aucune correction à appliquer**

| Métrique | Avant | Après correction | Écart |
|---|---|---|---|
| Brier | **0,01765** | 0,01978 | **+0,00213 (pire)** |
| NLL | 0,12252 | **0,10471** | −0,05781 |
| ECE | 0,00245 | **0,00229** | −0,00016 |

| Paramètre | Valeur |
|---|---|
| Diagnostic | `non_calibrable` |
| Correction retenue | **aucune** |
| Température estimée | 1,5912 |
| IC95 de la température | [0,9957 ; 2,1094] |
| L'IC95 exclut-il 1,0 | **non** |
| Pente (Platt) | 0,6435 |
| Ordonnée (Platt) | 0,1823 |
| Temperature estimable | oui |

**Pourquoi aucune correction.** Le modèle est déjà très bien calibré : un ECE
de 0,0025 est excellent, et la température estimée n'est pas distinguable de 1.
Appliquer une correction dégraderait le Brier — la métrique de référence. Le
gain de NLL ne vient que de la queue de distribution, pas d'une meilleure
qualité probabiliste. **La conclusion honnête est que `tb_edge_v2` doit être
utilisé tel quel, sans post-traitement.**

Ce résultat n'est pas un échec de l'outil : `non_calibrable` est précisément le
verdict correct quand la correction n'apporte rien.

## Point opératoire (rappel cible 0,90, sans calibration)

| Seuil | Rappel | Précision | Spécificité |
|---|---|---|---|
| 0,5835 | 0,9067 | **1,0000** | **1,0000** |

À ce seuil, sur 420 images : **7 faux négatifs, 0 faux positif**. C'est un point
opératoire remarquablement propre — et il faut le lire avec la limite n° 2
ci-dessous, car il repose sur un découpage déterministe.

## Limites — à lire avant toute réutilisation

1. **Ce n'est pas un hold-out indépendant.** Les 420 images de test sortent du
   même pool que l'entraînement, par un découpage déterministe à graine fixe.
   L'image 2087 (`Tuberculosis-2087.png`) a été inspectée manuellement, donc elle
   a été vue par un humain pendant la préparation. Le risque de fuite de
   sélection est faible mais **nul n'est garanti** : aucune généralisation à un
   autre hôpital, appareil ou population n'est établie.
2. **6 positifs se situent sous le maximum des négatifs.** Le négatif le plus
   haut atteint 0,482 ; 6 positifs sur 75 tombent en dessous. Le rappel de 0,90
   est donc atteint en sacrifiant 7 positifs, et l'excellente spécificité dépend
   de cette queue.
3. **Aucun early stopping.** Les 50 epochs ont été consommés : le modèle a
   convergé ou sur-appris sans que la validation ne l'interrompe. Une extension
   du budget d'epochs n'est pas justifiée par ce run.
4. **La queue s'effondre vers zéro.** 171 prédictions sur 420 sont ≤ 5e-5, la
   plus petite valant **1,5e-20**. Ce n'est pas une saturation du modèle
   (aucune valeur n'est exactement 0,0 : le kernel la representait encore) mais
   un sous-flot de float32. Conséquence runtime réelle : les services
   arrondissent la confiance à **4 décimales**, donc ces 171 images sont
   toutes affichées `0.0000` et **indiscernables entre elles** pour la logique
   d'escalade de confiance. C'est la limite opérationnelle principale de ce
   modèle.
5. **Binaire, mono-label.** Aucune information sur la pneumonie. Le croisement
   TB × PN reste non résolu et exige une annotation clinique.
6. **Comparaison avec v1 non faite.** Les performances de `tb_edge_v1` (ancien
   modèle 512 Mo du service) n'ont pas été rejouées sur ce même découpage. Toute
   affirmation d'amélioration ou de dégradation serait non étayée.

## Précision — un artefact d'outil corrigé en cours de route

La première adaptation des prédictions arrondissait la probabilité à six
décimales. Sur ce modèle cela **écrasait la queue** : 74 prédictions tombaient
à `0.000000`, la calibration voyait une saturation que le modèle ne produit pas,
et la NLL ne concordait plus avec celle du notebook. `adaptateur_predictions.py`
écrit désormais en pleine précision (`%.17g`) et un test
(`test_queue_de_distribution_non_ecrasee`) verrouille ce comportement.

Ce point est signalé parce qu'il illustre le piège général : **arrondir une
probabilité peut inventer une pathologie du modèle.** Pour `pn_edge_v2`, dont les
probabilités restent entre 0,174 et 0,998, l'arrondi n'avait aucun effet — les
mêmes chiffres ont été confirmés après correction.

## Traçabilité

| Artefact | Chemin |
|---|---|
| Modèle | `experimentations/modeles_v2/aeris_tb_edge_96.keras` (352 685 octets) |
| Prédictions test | `experimentations/resultats/modeles_v2/predictions_test_tb_edge_96.csv` (420 lignes) |
| Métriques brutes | `experimentations/resultats/modeles_v2/metrics_tb_edge_96.json` |
| Scores adaptés | `experimentations/resultats/calibrage/tuberculose_tb_edge_v2_scores.csv` |
| Rapport calibration | `experimentations/resultats/calibrage/tuberculose_tb_edge_v2_rapport.json` |
| Notebook | `kernels/kaggle/tb-edge-96/tb-edge-96.ipynb` |
| Manifestes | `experimentations/manifestes/tuberculose_{entrainement,validation,test}.csv` |

Les `.keras` sont ignorés par `.gitignore` (règle « modèles non versionnés » du
projet) : ils sont présents sur le disque mais ne suivent pas Git. Les CSV de
prédictions et les métriques, eux, sont versionnés : ce sont les preuves.

**Ces modèles v2 ne remplacent pas les modèles déployés.** Les services
utilisent toujours `services/service-*/modeles_entraines/*.h5` (modèles v1). Les
v2 sont experimentalisés à part et ne doivent pas y être copiés sans revue.

## Attribution

Dataset de radiographies thoraciques tuberculeuses : Tawsifurrahman et al.,
*IEEE Access*, 2020, DOI [10.1109/ACCESS.2020.3031384](https://doi.org/10.1109/ACCESS.2020.3031384).
Modèle entraîné par AERIS ; résultats destinés à la recherche, pas à un usage
clinique.
