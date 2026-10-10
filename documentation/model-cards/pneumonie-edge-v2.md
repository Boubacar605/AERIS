# Model card — Pneumonie Edge v2 (`pn_edge_v2`)

> Les chiffres de cette page sont **mesurés**, pas estimés. Source :
> `experimentations/resultats/calibrage/pneumonie_pn_edge_v2_rapport.json`.
> Aucun service de production n'utilise ce modèle : il est évalué hors ligne.

## Entraînement

| Champ | Valeur |
|---|---|
| Architecture | CNN séquentielle, 3 × (Conv2D + MaxPool) 16/32/64, GlobalAveragePooling, Dropout 0,3, Dense 32 |
| Entrée | 96 × 96, niveaux de gris, `[0;1]` |
| Tête | Dense 1, `sigmoid` — la sortie **est** la probabilité de pneumonie |
| Optimisation | Adam 1e-3, `binary_crossentropy`, Batch 32 |
| Arrêt | `EarlyStopping` sur `val_loss`, patience 8 |
| Epochs effectifs | 12 |
| Graine | 42 (`random`, `numpy`, `tensorflow`) |
| Pool | `paultimothymooney/chest-xray-pneumonia` (Mooney) |
| Split | natif : `train` 5216 / `val` 16 / **`test` 624 (hold-out)** |
| Pool d'évaluation | 624 images, 390 positives (prévalence 0,625) |
| Pool de validation | **16 images** — voir « Limites » |
| Entraînement hors ligne | Kaggle `boubaniang/aeris-pn-edge`, notebook version 10 |

Le lot `test` n'a servi ni à l'entraînement ni au choix d'epoch : la sélection
se fait sur `val`. C'est le même hold-out que celui utilisé pour la calibration
des modèles v1, ce qui rend les deux études comparables.

## Performances brutes (hold-out, 624 images)

| Métrique | Valeur |
|---|---|
| AUC | **0,8227** |
| Brier | 0,19315 |
| NLL | 0,58064 |
| ECE (10 tranches) | 0,01426 |
| Brier skill | 0,17589 |

## Calibration

| Métrique | Avant | Après | Écart |
|---|---|---|---|
| Brier | 0,19315 | **0,17821** | −0,01494 |
| NLL | 0,58064 | **0,52267** | −0,05797 |
| ECE | 0,01426 | **0,00978** | −0,00448 |

| Paramètre | Valeur |
|---|---|
| Diagnostic | `exces_de_confiance` |
| Correction retenue | `temperature_scaling` |
| Température | **1,8946** |
| IC95 de la température | [1,6319 ; 2,1949] |
| L'IC95 exclut-il 1,0 | **oui** (1000 tirages bootstrap) |
| Pente (Platt) | 0,7666 |
| Ordonnée (Platt) | −0,7687 |

La température est **identifiable** sur ce modèle : 0 prédiction ne sature
(`saturation_float32 = 0`) et l'intervalle de confiance exclut 1,0. Cela lève
le blocage constaté sur les modèles v1, où 192 prédictions sur 624 saturaient.
Voir `documentation/protocole-split-donnees.md` §5.0.

## Point opératoire (rappel cible 0,90)

| Seuil | Rappel | Précision | Spécificité |
|---|---|---|---|
| 0,5391 | 0,9000 | 0,7297 | 0,4444 |

## Limites — à lire avant toute réutilisation

1. **Le lot de validation fait 16 images.** C'est trop peu pour early stopping :
   la meilleure epoch est choisie sur un signal très bruité. Les métriques de
   validation affichées pendant l'entraînement ne sont pas exploitables, seule
   la mesure sur les 624 images du hold-out l'est.
2. **AUC 0,82 est nettement en dessous du modèle v1 (0,9583).** L'architecture
   à trois convolutions est délibérément légère (contrainte Edge simulée), mais
   la différence ne doit pas être lue comme un progrès : `pn_edge_v2` est un
   **modèle distinct et plus faible**, pas une version améliorée de v1.
3. **Spécificité 0,44 au rappel 0,90.** À ce point de fonctionnement, plus de
   la moitié des radiographies normales sont classées positives. Aucun
   déploiement clinique n'est envisageable en l'état.
4. **Binaire, mono-label.** Le modèle ne dit rien de la tuberculose. Le
   croisement TB × PN reste non résolu et exige une annotation clinique.
5. **Pas de validation externe.** Les performances sont mesurées sur le même
   corpus que l'entraînement, découpage déterministe aidant. Aucune généralisation
   à un autre hôpital, un autre appareil ou une autre population n'est établie.

## Traçabilité

| Artefact | Chemin |
|---|---|
| Modèle | `experimentations/modeles_v2/aeris_pn_edge.keras` (352 685 octets) |
| Prédictions test | `experimentations/resultats/modeles_v2/predictions_test_pn_edge.csv` (624 lignes, probabilités + logits) |
| Métriques brutes | `experimentations/resultats/modeles_v2/metrics_pn_edge.json` |
| Scores adaptés | `experimentations/resultats/calibrage/pneumonie_pn_edge_v2_scores.csv` |
| Rapport calibration | `experimentations/resultats/calibrage/pneumonie_pn_edge_v2_rapport.json` |
| Notebook | `kernels/kaggle/pn-edge/pn-edge.ipynb` |

Les `.keras` sont ignorés par `.gitignore` (règle « modèles non versionnés ») :
présents sur disque, non suivis par Git. Les CSV de prédictions et les
métriques sont versionnés.

**Ce modèle ne remplace pas le modèle déployé.** Le service
`service-pneumonie` utilise toujours `modeles_entraines/modele_pneumonie.h5`
(v1, AUC 0,958). `pn_edge_v2` est experimentalisé à part et ne doit pas y être
copié sans revue clinique.

## Attribution

Dataset Mooney (Kermany et al., 2018), via le dataset Kaggle
`paultimothymooney/chest-xray-pneumonia`. Le modèle est entraîné par AERIS ;
les résultats de cette page couvrent la recherche du projet, pas un usage clinique.
