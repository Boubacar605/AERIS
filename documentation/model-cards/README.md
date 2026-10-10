# Model cards — AERIS

Deux générations cohabitent dans ce dossier :

- **v3 (Edge) — en service depuis le 09/10/2026.** `pn_edge_v3` et `tb_edge_v3`
  ont remplacé les modèles v1 dans `services/service-*/modeles_entraines/*.h5`.
  Voir « v3 Edge en service » ci-dessous et les pages dédiées.
- **Cloud v1 — conservés en service.** Aucun v3 Cloud n'est produit. Le plafond
  0,995 s'applique néanmoins aux **quatre** services (edge **et** cloud) : la
  confiance cloud ne peut plus afficher « 100 % » non plus.
- **v2 — expérimentaux hors ligne.** Les pages v2 restent la trace de l'étude
  précédente ; **aucun service n'utilise v2**.

Les modèles **v1** (anciens modèles en service) ne font pas l'objet d'une page :
leurs performances ne figurent ici qu'en **référence**, mesurées sur le hold-out
dédupliqué des études v3.

## v3 Edge en service

Les deux modèles Edge en service sont les v3. Ils sont entraînés sur un hold-out
**dédupliqué par SHA-256 de contenu** (0 doublon inter-lots) ; la pneumonie
applique en outre une **augmentation par epoch** (sans cache), correctif du défaut
qui faisait surapprendre `pn_edge_v2` dès l'epoch 4.

| Modèle | Pathologie | AUC | Brier | NLL | affichaient « 100 % » (brut → après plafond) |
|---|---|---|---|---|---|
| `pn_edge_v3` | Pneumonie | 0,97736 | 0,05150 | 0,18074 | 139 / 583 → **0** |
| `tb_edge_v3` | Tuberculose | **0,99400** | **0,01894** | **0,07451** | 31 / 420 → **0** |

Référence **v1 sur le même hold-out dédupliqué** (obtenue en rejouant le `.h5`
v1, pas les scores de l'étude v2) :

| Pathologie | AUC v1 → v3 | Brier v1 → v3 | NLL v1 → v3 |
|---|---|---|---|
| Pneumonie | 0,98648 → 0,97736 | 0,07643 → **0,05150** | 0,26777 → **0,18074** |
| Tuberculose | 0,74980 → **0,99400** | 0,19724 → **0,01894** | 0,59045 → **0,07451** |

Points structurants :

1. **Le plafond 0,995 est appliqué dans le service**, pas seulement à l'affichage
   (`inference.py`, `SEUIL_SATURATION`) et **sur les quatre services** : l'API ne
   renvoie plus jamais 1,0, cloud v1 compris. La calibration (T < 1) est propre
   aux modèles Edge v3 et détaillée dans chaque page v3.
2. **La convention PN Edge a changé.** v1 sortait `P(NORMAL)` (`score < 0,5` =
   pneumonie) ; v3 sort `P(PNEUMONIE)` (`score ≥ 0,5`). Le code d'inférence a été
   adapté. Restaurer v1 sans restaurer le code inverserait les verdicts : c'est
   pourquoi `sauvegardes/restaurer-v1.sh` restaure **modèles et code** (voir
   `sauvegardes/LISEZ-MOI.md`).
3. **PN v3 n'améliore pas l'AUC** (léger recul, non significatif sur les 63
   images jamais vues par v1) : le gain porte sur Brier/NLL et la fin de la
   saturation. **TB v3 améliore les quatre critères.**
4. **Limite connue et non corrigée.** Le notebook TB v3 garde une augmentation
   **mise en cache** (même image augmentée à chaque epoch), le défaut corrigé
   côté pneumonie. Le modèle reste excellent, mais une reprise avec augmentation
   par epoch est la suite logique ; elle n'est ni faite ni validée.

## v2 contre v1, sur le même jeu de test

## v2 contre v1, sur le même jeu de test

Les scores v1 de `pneumonie_edge_scores.csv` et `pneumonie_cloud_scores.csv`
ont été collectés sur les **services en production**, sur les mêmes 624 images
Mooney que les notebooks v2. La comparaison est donc directe, et elle est
défavorable à v2 sur l'axe Edge :

| Pneumonie Edge | AUC | Brier | NLL | faux positifs | faux négatifs | affichent « 100 % » |
|---|---|---|---|---|---|---|
| **v1 (en service)** | **0,9583** | **0,08054** | **0,46005** | **53** | **6** | 292 / 624 |
| v2 | 0,8227 | 0,19315 | 0,58064 | 147 | 26 | 25 / 624 |

| Pneumonie Cloud | AUC | Brier | NLL | faux positifs | faux négatifs | affichent « 100 % » |
|---|---|---|---|---|---|---|
| v1 (en service) | 0,9505 | **0,13174** | 0,48272 | **102** | 7 | 287 / 624 |
| v2 | **0,9668** | 0,17025 | 1,11042 | 115 | **2** | 434 / 624 |

**Le modèle Edge v2 est une régression clinique**, pas une amélioration :
-13,6 points d'AUC, 2,8 fois plus de faux positifs, 4,3 fois plus de faux
négatifs. Le cloud v2 est meilleur sur le classement (AUC) et sur le rappel,
mais plus mal calibré et avec davantage de faux positifs.

**Conséquence : v2 n'est pas déployé.** Voir « Pourquoi la calibration ne
suffit pas » ci-dessous.

## Pourquoi la calibration ne suffit pas

Une saturation à 100 % ressemble à un défaut de calibration, et il serait
tentant d'y répondre par un temperature scaling. Sur les scores v1, cette
réponse est **mesurablement fausse** — calibration par validation croisée
5 plis, la température étant estimée hors du pli évalué :

| Pneumonie Edge v1 | avant | après | |
|---|---|---|---|
| Brier | **0,08054** | 0,18154 | dégradé |
| NLL | **0,46005** | 0,50706 | dégradé |
| ECE | **0,00860** | 0,01735 | dégradé |

Le modèle Edge v1 est **déjà bien calibré** (ECE 0,0086). La température
estimée (2,61 en moyenne) tire ses probabilités vers 0,5 et détruit un
apprentissage correct. Les trois métriques se dégradent.

Sur le cloud v1, la correction améliore la NLL (0,483 → 0,414) mais dégrade
le Brier et l'ECE : là non plus elle ne se justifie pas.

**Donc le « 100 % » n'est pas un défaut du modèle, c'est un défaut
d'affichage.** La valeur est réellement saturée en float32, et aucun
recadrage numérique ne peut inventer de la précision qui n'existe pas.
Le correctif est dans la présentation : au-delà de 0,995, l'interface
affiche « plus de 99 % » au lieu de « 100 % ». Voir
`formatConfiance()` dans `tableau-de-bord/src/lib/format.ts`.

## État

Les quatre entraînements sont terminés et les quatre jeux de scores sont
versionnés. **Un résultat domine tous les autres** : voir « Séparabilité ».

| Modèle | Pathologie / couche | AUC | Brier | Calibration retenue | Point à rappel 0,90 (seuil / précision / spécificité) |
|---|---|---|---|---|---|
| `pn_edge_v2` | Pneumonie / Edge | 0,8227 | 0,19315 | température, T = 1,8946 | 0,5391 / 0,7297 / 0,4444 |
| `pn_cloud_v2` | Pneumonie / Cloud | 0,9668 | 0,17025 | température, T = 6,4850 | 0,8105 / 0,9435 / 0,9103 |
| `tb_edge_v2` | Tuberculose / Edge | 0,9731 | 0,01765 | **aucune** (`non_calibrable`) | 0,5835 / 1,0000 / 1,0000 |
| `tb_cloud_v2` | Tuberculose / Cloud | **1,0000** | 2,3e-06 | **aucune** (`temperature_non_estimable`) | 1,0000 / 1,0000 / 1,0000 |

### Séparabilité : le résultat central

`tb_cloud_v2` ordonne les 420 images de test **sans une seule inversion** :
toute image tuberculeuse reçoit au moins 0,9727, toute image normale au plus
0,0083.

Un contrôle d'intégrité (`boubaniang/aeris-diag-fuite-tb`) a établi deux choses
distinctes, qu'il ne faut pas confondre :

1. **Une fuite avérée** : `Tuberculosis-243.png` (test) est identique
   octet pour octet à `Tuberculosis-244.png` (train), même SHA-256. Les
   manifestes doivent être régénérés avec dé-duplication.
2. **Mais cette fuite n'explique pas l'AUC de 1,0** : en retirant l'image
   fautive, l'AUC reste exactement 1,000000.

Donc la séparabilité vient du **corpus**, pas de la fuite. Ce jeu de données
ne présente pas la difficulté d'un dépistage réel, et **aucun des quatre
modèles ne doit être présenté comme ayant une performance clinique établie.**
C'est une donnée de contexte, pas un résultat de performance.

Le même contrôle a produit 234 513 paires « proches » par `dhash`, dont 80 933
entre lots : ce chiffre est un **artefact du détecteur** (64 bits ne suffisent
pas à distinguer deux poumons norms à 8 × 8), pas une mesure de fuite. Seul le
doublon strict est exploitable.

### Saturation à quatre décimales : une limite opérationnelle commune

| Modèle | `p` affichées `0.0000` | `p` affichées `1.0000` |
|---|---|---|
| `pn_edge_v2` | 0 | 0 |
| `pn_cloud_v2` | 6 | 362 |
| `tb_edge_v2` | 171 | 3 |
| `tb_cloud_v2` | 333 | 70 |

Les services arrondissent la confiance à **quatre décimales**. Pour `tb_cloud_v2`,
**403 des 420 prédictions sont donc indiscernables** pour la logique
d'escalade de confiance. C'est une limite du système, pas des modèles, et elle
n'apparaît dans aucune métrique.

## Pages

**v3 (Edge, en service)**

- [`pneumonie-edge-v3.md`](pneumonie-edge-v3.md)
- [`tuberculose-edge-v3.md`](tuberculose-edge-v3.md)

**v2 (hors ligne, non déployés)**

- [`pneumonie-edge-v2.md`](pneumonie-edge-v2.md)
- [`pneumonie-cloud-v2.md`](pneumonie-cloud-v2.md)
- [`tuberculose-edge-v2.md`](tuberculose-edge-v2.md)
- [`tuberculose-cloud-v2.md`](tuberculose-cloud-v2.md)

## Règles communes à toutes les pages

1. **Les chiffres sont mesurés, jamais estimés.** Chaque valeur provient d'un
   JSON de métriques ou d'un rapport de calibration versionné dans
   `experimentations/resultats/`.
2. **Aucune affirmative d'amélioration sans base comparée.** `pn_edge_v2` est
   plus faible que le v1 (0,8227 contre 0,9583) : c'est écrit, pas masqué.
3. **Un point opératoire n'est jamais présenté seul.** Il est toujours
   accompagné du rappel, de la précision et de la spécificité.
4. **Les limites cliniques priment sur les métriques.** Une ROC haute ne rend
   pas un modèle déployable ; les pages disent explicitement ce qui manque.
5. **Un artefact d'outil n'est jamais attribué au modèle.** C'est ainsi qu'a été
   trouvé l'arrondi quimanufacturait une saturation sur `tb_edge_v2` (§ «
   Précision » de sa page).

## Prochaine étape

1. **Décider du sort de v2 sur des fondements mesurés, pas sur l'AUC seul.**
   Le classement cloud v2 est meilleur, l'edge v2 est une régression. Les
   quatre modèles v2 exigent en outre quatre adaptations de compatibilité
   (format Keras 3, normalisation `preprocess_input`, polarité de `pn_edge`,
   sortie sigmoid au lieu du softmax de `tb_edge`) avant d'être déployables.
   Aucun de ces points n'a été fait : ce sont des décisions d'architecture.
2. **Régénérer les manifestes TB avec dé-duplication sur SHA-256.** Un
   doublon strict traverse le test ; tant qu'il est là, tous les scores TB de
   ce dossier sont des bornes hautes. C'est au notebook de dédupliquer, pas à
   une commande manuelle.
3. **Trouver un corpus de vérification qui ne soit pas ce pool.** C'est la
   seule façon de découvrir si la séparabilité triviale masque une performance
   médiocre.
4. **Annoter cliniquement les 700 images tuberculeuses** (pneumonie
   associée ou non) : sans cela, le croisement TB × PN reste non résolu.
5. **Ne pas dériver de seuil de production** avant les trois points ci-dessus.
   Les seuils de ces pages sont réglés sur le jeu de test et ne valent rien
   ailleurs. Ni v1 ni v2 n'a de corpus de vérification externe.
