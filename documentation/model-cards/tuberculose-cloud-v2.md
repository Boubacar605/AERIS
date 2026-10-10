# Model card — Tuberculose Cloud v2 (`tb_cloud_v2`)

> Chiffres **mesurés**. Source :
> `experimentations/resultats/calibrage/tuberculose_tb_cloud_v2_rapport.json`.
> Aucun service de production n'utilise ce modèle.
> ⚠️ **Cette page porte le résultat le plus important de l'étude.**
> L'AUC de 1,0000 de ce modèle ne mesure pas une performance clinique :
> elle mesure d'abord la facilité du jeu de données. Lire la section
> « Séparabilité » avant toute autre.

## Entraînement

| Champ | Valeur |
|---|---|
| Architecture | DenseNet121 pré-entraîné ImageNet, 320 × 320 RVB |
| Transfert | 28 epochs gelés, puis 25 epochs affinés |
| Tête | Dense 1, `sigmoid` — la sortie **est** la probabilité de tuberculose |
| Pool | `tawsifurrahman/tuberculosis-tb-chest-xray-dataset` (4200 images) |
| Split | déterministe, graine 42 : `train` 3360 / `val` 420 / **`test` 420** |
| Positifs | `train` 555 / `val` 70 / **`test` 75** |
| Manifestes | vérifiés octet pour octet identiques au dépôt après le run |
| Entraînement hors ligne | Kaggle `boubaniang/aeris-tb3-cloud-d121`, version 1 |
| Artefacts | `aeris_tb_cloud_densenet121.keras` (35 605 069 octets) |

## Performances brutes (hold-out, 420 images)

| Métrique | Valeur |
|---|---|
| AUC | **1,000000** |
| Brier | 2,298272e-06 |
| NLL | 1,417549e-04 |
| ECE | — |
| Saturation float32 (seuil 1e-6) | 62 |

Ces trois valeurs viennent du notebook (`EPSILON = 1e-7`). L'analyseur, qui
borne à `1e-12`, obtient une NLL de 1,416571e-04, soit 0,07 % plus basse :
l'écart vient de la borne de protection appliquée à des probabilités déjà
saturées, il est sans effet sur l'AUC, qui ne dépend que du classement. Les
tableaux de calibration de cette page citent **toujours** la valeur de
l'analyseur, pour que la comparaison avant/après soit homogène.

## Séparabilité : le résultat central de cette page

Les 420 prédictions sont **parfaitement ordonnées**, sans une seule inversion :

| Mesure | Valeur |
|---|---|
| Probabilité maximale parmi les 345 négatifs | **8,2796e-03** |
| Probabilité minimale parmi les 75 positifs | **9,7267e-01** |
| Positifs sous le maximum des négatifs | **0** |
| Écart entre les deux groupes | d'un facteur ~117 |

Autrement dit : *toute* radiographie tuberculeuse du test reçoit au moins
0,97, et *toute* radiographie normale reçoit au plus 0,0083. Un écart de cet
ordre ne laisse aucun doute au classifieur.

**Conséquence directe : ce jeu de données ne présente pas la difficulté d'un
dépistage réel.** Il ne peut donc pas servir de démonstration de la capacité
clinique d'un modèle. L'AUC de 1,0000 mesure la séparabilité du corpus, pas la
qualité d'un diagnostic. Le même modèle, évalué sur un corpus hospitalier, n'a aucune raison d'obtenir ce chiffre.

C'est la limite la plus importante de cette étude, et elle concerne les
quatre modèles autant que celui-ci.

## Fuite de données : confirmée, mais sans rapport avec l'AUC de 1,0

Un contrôle d'intégrité a été conduit sur les 4200 images montées sur Kaggle
(kernel `boubaniang/aeris-diag-fuite-tb`, v3) : SHA-256 pour les doublons
stricts, `dhash` pour les quasi-doublons.

| Contrôle | Résultat |
|---|---|
| Chevauchement des manifestes (chemins) | 0 sur 3360 / 420 / 420 |
| Fichiers distincts | 4200 (attendu 4200) |
| **Doublons stricts traversant deux lots** | **1** |
| Paires à distance de `dhash` ≤ 5 | 234 513, dont 80 933 entre lots |

Le doublon strict est le suivant :

| Lot | Image | SHA-256 |
|---|---|---|
| **test** | `Tuberculosis/Tuberculosis-243.png` | `e6d26454…24ebe` |
| **train** | `Tuberculosis/Tuberculosis-244.png` | `e6d26454…24ebe` |

**Mais l'image fautive n'explique pas le score parfait.** En la retirant du
test :

| | AUC complet | AUC sans l'image qui fuit |
|---|---|---|
| `tb_cloud_v2` | 1,000000 | **1,000000** |
| `tb_edge_v2` | 0,973140 | 0,972777 |

L'AUC de `tb_cloud_v2` reste exactement 1,000000 : la fuite est réelle et
doit être corrigée dans les manifestes, mais elle n'est pas la cause de la
séparabilité. **Ce sont deux problèmes distincts, et les traiter comme un seul
serait une erreur d'analyse.**

### Sur les 80 933 « quasi-doublons » : ne pas les compter comme des fuites

Ce chiffre est un **artefact du détecteur**, pas un constat. Un `dhash` de
64 bits sur une radiographie 8 × 8 ne distingue pas deux poumons norms : avec
un seuil de distance ≤ 5 sur 64 bits, la majeure partie des radiographies
normales s'apparient entre elles. Sur les 3500 images normales, seules 3264
ont un `dhash` distinct — l'espace est trop petit pour 3500 empreintes
utiles.

Le seul chiffre exploitable de ce contrôle est le **1 doublon strict**. Les
234 513 paires doivent être lues comme « ce seuil de quasi-doublon est trop
permissif pour ce type d'image », pas comme « 6 % du jeu fuit ». Un seuil
correct demanderait un vrai descripteur d'image (hachage perceptuel
64 × 64, ou un modèle d'embeddings), pas un hash de 64 bits.

## Calibration — **aucune correction, la température n'est pas estimable**

| Métrique | Avant | Après | Écart |
|---|---|---|---|
| Brier | 2,298270e-06 | 2,298270e-06 | **0** |
| NLL | 1,416571e-04 | 1,416571e-04 | **0** |

| Paramètre | Valeur |
|---|---|
| Diagnostic | `temperature_non_estimable` |
| Correction retenue | **aucune** |
| Température | **non estimable** |
| IC95 | non estimable |
| Pente (Platt) | 3,9410 |
| Ordonnée (Platt) | 2,4932 |

**Pourquoi la température n'est pas estimable.** L'espace de recherche est borné
à `1e-2 … 1e2`. Sur un jeu déjà parfaitement séparé, la vraisemblance est
minimisée en poussant T vers 0 : les probabilités partent vers 0 et 1, ce qui
annule la NLL. L'optimum est donc **sur la frontière**, et la valeur renvoyée
serait la borne — pas une mesure. L'outil renvoyait `T = 0,0100` en annonçant
« IC95 exclut 1,0 » et proposait un seuil `1,0000`, ce qui n'a aucun sens.

Ce défaut est **corrigé** depuis : `ajuster_temperature` refuse un optimum à la
frontière, `evaluer()` bascule alors sur `temperature_non_estimable` et
n'applique rien. Deux tests verrouillent le comportement
(`test_logits_constants_refuses_car_la_temperature_n_est_pas_identifiable` et
`test_des_logits_non_finis_sont_refuses`). Voir
`documentation/protocole-split-donnees.md` § 6.4.

Les colonnes « avant » et « après » sont identiques **par construction**, pas
par similarité : aucune correction n'a été appliquée.

## Point opératoire (rappel cible 0,90, échelle brute)

| Seuil | Rappel | Précision | Spécificité |
|---|---|---|---|
| 1,0000 | 0,9067 | 1,0000 | 1,0000 |

⚠️ Ce seuil est **un artefact d'affichage**, pas une propriété du modèle :
70 prédictions sur 420 s'affichent `1.0000` après arrondi à quatre décimales,
et 333 s'affichent `0.0000`. La grille d'arrondi ne contient que 17
intermédiaires.

**C'est la limite opérationnelle majeure de ce modèle** : dans le système, la
confiance est arrondie à quatre décimales, donc ces 403 images sont
**indiscernables entre elles** pour la logique d'escalade de confiance. 68
positifs sur 75 partagent la valeur `1.0000` avec le seuil, et la
décision «TB présent » ne peut pas être nuancée.

## Limites

1. **L'AUC de 1,0000 ne doit pas être présentée comme un résultat clinique.**
   Voir « Séparabilité » ci-dessus. C'est la limite première.
2. **Le corpus est entaché.** Un doublon strict traverse le test. Les manifestes
   doivent être régénérés avec dé-duplication sur SHA-256 avant toute
   publication. Les scores de cette page sont donc des bornes hautes.
3. **Aucune validation externe.** Tout vient du même pool de 4200 images, avec
   un patient unique par radiographie (donc sans fuite par patient) mais sans
   aucun autre établissement, aucun autre appareil, aucune autre population.
4. **Binaire, mono-label.** Aucune information sur la pneumonie ; le croisement
   TB × PN reste non résolu et exige une annotation clinique.
5. **Le contraste avec `tb_edge_v2` ne mesure pas ce que l'on croit.** L'Edge
   atteint 0,9731, le Cloud 1,0000, sur le même test. Mais l'Edge échoue sur
   **6 positifs sur 75**, dont un à 7,58e-06 : l'écart de 0,027 d'AUC tient
   entièrement à ces cas limites, pas à un gain de cohérence générale.
6. **Aucune conclusion de déploiement.** Ce modèle n'est pas validé pour un
   usage clinique, et cette page ne fournit aucun élément qui pourrait le
   justifier.

## Traçabilité

| Artefact | Chemin |
|---|---|
| Modèle | `experimentations/modeles_v2/aeris_tb_cloud_densenet121.keras` |
| Prédictions test | `experimentations/resultats/modeles_v2/predictions_test_tb_cloud_d121.csv` |
| Métriques brutes | `experimentations/resultats/modeles_v2/metrics_tb_cloud_d121.json` |
| Scores adaptés | `experimentations/resultats/calibrage/tuberculose_tb_cloud_v2_scores.csv` |
| Rapport calibration | `experimentations/resultats/calibrage/tuberculose_tb_cloud_v2_rapport.json` |
| Notebook entraînement | `kernels/kaggle/tb-cloud-densenet121/tb-cloud-densenet121.ipynb` |
| Notebook diagnostic fuite | `kernels/kaggle/diag-fuite-tb/diag-fuite-tb.ipynb` |
| Manifestes | `experimentations/manifestes/tuberculose_{entrainement,validation,test}.csv` |

`.keras` ignorés par `.gitignore` ; CSV et métriques versionnés. **Ce modèle ne
remplace pas `modele_tuberculose_cloud.h5` déployé.**

## Attribution

Tawsifurrahman et al., *IEEE Access*, 2020,
DOI [10.1109/ACCESS.2020.3031384](https://doi.org/10.1109/ACCESS.2020.3031384).
Entraînement AERIS, recherche et non diagnostic.
