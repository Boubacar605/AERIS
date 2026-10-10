# Model card — Pneumonie Cloud v2 (`pn_cloud_v2`)

> Chiffres **mesurés**. Source :
> `experimentations/resultats/calibrage/pneumonie_pn_cloud_v2_rapport.json`.
> Aucun service de production n'utilise ce modèle.

## Entraînement

| Champ | Valeur |
|---|---|
| Architecture | DenseNet121 pré-entraîné ImageNet, 320 × 320 RVB |
| Transfert | 18 epochs gelés, puis 30 epochs affinés |
| Tête | Dense 1, `sigmoid` — la sortie **est** la probabilité de pneumonie |
| Pool | `paultimothymooney/chest-xray-pneumonia` (Mooney) |
| Split | natif : `train` 5216 / `val` 16 / **`test` 624 (hold-out)** |
| Pool d'évaluation | 624 images, 390 positives (prévalence 0,625) |
| Entraînement hors ligne | Kaggle `boubaniang/aeris-pn-cloud`, version 10 |
| Artefacts | `aeris_pn_cloud_densenet121.keras` (35 605 069 octets) |

## Performances brutes (hold-out, 624 images)

| Métrique | Notebook | Analyseur |
|---|---|---|
| AUC | 0,96677 | **0,9668** |
| Brier | 0,170250 | **0,17025** |
| NLL | 1,091842 | 1,11042 |
| ECE | — | 0,01826 |
| Saturation float32 (seuil 1e-6) | **229 / 624** | 208 exactement 1,0 |

L'écart de NLL entre les deux sources vient de la borne de protection
(`EPSILON = 1e-7` dans le notebook, `1e-12` côté analyseur) appliquée à des
probabilités déjà saturées. Il est sans effet sur l'AUC, qui ne dépend que du
classement.

## Saturation : 36,7 % des prédictions sont à 1,0

C'est le point dominant de ce modèle, et il conditionne toute la calibration.

| Mesure | Valeur |
|---|---|
| `p >= 1 - 1e-6` | 229 (36,7 %) |
| `p == 1.0` exactement | 208 |
| `p <= 1e-6` | 0 |
| Minimum | 1,82e-07 |

Le modèle ne sature **que par le haut**, ce qui est cohérent avec la
prédominance des positifs (62,5 %).

## Calibration — temperature scaling retenue, mais la valeur est fragile

| Métrique | Avant | Après | Écart |
|---|---|---|---|
| Brier | 0,17025 | **0,12235** | −0,04790 |
| NLL | 1,11042 | **0,36881** | −0,74161 |
| ECE | 0,01826 | **0,01529** | −0,00297 |

| Paramètre | Valeur |
|---|---|
| Diagnostic | `exces_de_confiance` |
| Correction retenue | `temperature_scaling` |
| Température | 6,4850 |
| IC95 | [5,6180 ; 7,3539] |
| L'IC95 exclut-il 1,0 | **oui** (1000 tirages) |
| Pente (Platt) | 0,3834 |
| Ordonnée (Platt) | −2,9320 |

### La valeur de T dépend d'une constante arbitraire

Les logits sont reconstruits depuis `p` par `logit()`, qui borne à
`EPSILON = 1e-12`. Comme 208 valeurs sont exactement 1,0, leur logit vaut
`toutes` la même constante. La température estimée dépend donc de cette
convention :

| `EPSILON` | logit plateau | T estimée | IC95 exclut 1,0 |
|---|---|---|---|
| 1e-6 | 13,82 | 5,2344 | oui |
| 1e-7 (notebook) | 16,12 | 5,5206 | oui |
| 1e-9 | 20,72 | 5,9526 | oui |
| **1e-12 (retenu)** | **27,63** | **6,4850** | **oui** |
| 1e-15 | 34,54 | 6,8857 | oui |
| 1e-18 | 41,45 | — | **échec** |

**Ce qu'on peut affirmer** : le modèle est nettement sur-confiant et un
temperature scaling l'améliore (le Brier passe de 0,170 à 0,122, le NLL de
1,11 à 0,37). Le IC95 exclut 1,0 sur toute la plage testée.

**Ce qu'on ne peut pas affirmer** : que T vaut 6,485. Un facteur 10 sur une
borne conventionnelle déplace T de 5,23 à 6,89. Rapporter T à trois décimales
serait une fausse précision.

⚠️ À `EPSILON = 1e-18`, `logit()` produit `inf`, la NLL vaut `nan` et la
section d'or se rabattait sur sa borne : l'outil renvoyait T = 0,01 en
annonçant « IC95 exclut 1,0 ». Ce défaut est **corrigé** depuis
(`calibrage.py` refuse un ajustement non estimable), voir
`documentation/protocole-split-donnees.md` § 6.4.

## Point opératoire (rappel cible 0,90, après calibration)

| Seuil | Rappel | Précision | Spécificité |
|---|---|---|---|
| 0,8105 | 0,9000 | **0,9435** | **0,9103** |

C'est de loin le meilleur point des quatre modèles : à 90 % de rappel, 94 % de
précision et 91 % de spécificité. Il reste Non conforme à un usage clinique
(voir limite 2).

## Limites

1. **La saturation n'est pas une mesure, c'est un floor de représentation.**
   Connaître la probabilité réelle de ces 208 images demanderait d'exposer le
   logit avant sigmoid — une modification de l'API d'inférence, donc une
   décision d'architecture.
2. **Valider ce point sur une autre population.** Les 624 images de test
   viennent du même corpus que les 5216 d'entraînement. Le seuil 0,8105 est
   réglé sur ce corpus et n'a aucune raison de valoir ailleurs. Le *Target
   Product Profile* de l'OMS ne fournit aucun repère pour un CAD de pneumonie :
   le seuil 0,90 est repris par analogie au cas TB, ce qui reste une limite à
   écrire.
3. **Binaire, mono-label.** Aucune information sur la tuberculose. Le
   croisement TB × PN n'est pas traité.
4. **Contre-performance de l'Edge à ne pas gommer.** `pn_edge_v2` atteint
   0,8227 avec une spécificité de 0,44 au même rappel. L'écart entre les deux
   couches est net et reproductible : c'est la seule comparaison de ce dossier
   où les deux modèles partagent le même jeu de test.

## Traçabilité

| Artefact | Chemin |
|---|---|
| Modèle | `experimentations/modeles_v2/aeris_pn_cloud_densenet121.keras` |
| Prédictions test | `experimentations/resultats/modeles_v2/predictions_test_pn_cloud.csv` |
| Métriques brutes | `experimentations/resultats/modeles_v2/metrics_pn_cloud.json` |
| Scores adaptés | `experimentations/resultats/calibrage/pneumonie_pn_cloud_v2_scores.csv` |
| Rapport calibration | `experimentations/resultats/calibrage/pneumonie_pn_cloud_v2_rapport.json` |
| Notebook | `kernels/kaggle/pn-cloud/pn-cloud.ipynb` |

`.keras` ignorés par `.gitignore` (modèles non versionnés) ; CSV et métriques
versionnés. **Ce modèle ne remplace pas `modele_pneumonie_cloud.h5` déployé.**

## Attribution

Dataset Mooney (Kermany et al., 2018) via
`paultimothymooney/chest-xray-pneumonia`. Entraînement AERIS, recherche et non diagnostic.
