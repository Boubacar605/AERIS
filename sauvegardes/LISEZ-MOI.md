# Sauvegardes des modèles Edge — procédure de bascule / restauration

Ce dossier permet de passer d'un jeu de modèles à l'autre **sans perte**, et de
revenir à v1 sur simple demande.

## Contenu

| Dossier | Rôle |
|---|---|
| `modeles-v1/` | 4 modèles v1 (PN et TB, edge **et** cloud) + `SHA256SUMS.txt` — l'état d'origine. |
| `code-v1/` | `inference.py` d'origine des deux services (convention PN Edge inversée, pas de calibration). |
| `modeles-v3/` | 2 modèles Edge v3 (`aeris_*_edge_v3.h5/.keras`), leurs métriques et prédictions + `SHA256SUMS.txt`. |
| `code-v3/` | `inference.py` v3 (calibration bornée à 0,995, convention PN corrigée). |

## Scripts

```bash
bash sauvegardes/restaurer-v1.sh   # remet les modèles ET le code v1, reconstruit les images Edge
bash sauvegardes/basculer-v3.sh    # remet les modèles ET le code Edge v3
```

## Pourquoi modèles **et** code

Le code n'est **pas** monté en volume : il est cuit dans l'image Docker. Et la
convention de sortie du modèle PN Edge a changé :

| | sortie | interprétation | plafond de confiance |
|---|---|---|---|
| v1 (PN edge) | `P(NORMAL)` | `score < 0,5` = pneumonie | aucun |
| v3 (PN edge) | `P(PNEUMONIE)` | `score ≥ 0,5` = pneumonie | 0,995 |

Copier les `.h5` sans le code inverserait donc les verdicts PN. Les deux scripts
copient modèles **et** code, puis reconstruisent les images (`docker compose
--profile edge up -d --build ...`).

## Contrôle d'intégrité

Chaque sauvegarde porte un `SHA256SUMS.txt` vérifiabe :

```bash
cd sauvegardes/modeles-v1 && sha256sum -c SHA256SUMS.txt
cd sauvegardes/modeles-v3 && sha256sum -c SHA256SUMS.txt
```

Empreintes de référence des modèles v1 :

| Fichier | SHA-256 |
|---|---|
| `modele_pneumonie.h5` (v1 edge) | `5e65314149a046a068c788376a60b89ce1c51d29029958fc7aad8f773d6fbc95` |
| `modele_pneumonie_cloud.h5` (v1 cloud) | `60ddac75169b2a7972d85af86388648a083680458513e583a5d7f43edd03881c` |
| `modele_tuberculose.h5` (v1 edge) | `a47d5db2b5a96e6741cb219de6b77d33155070012c27994ba2cd730c81219ebd` |
| `modele_tuberculose_cloud.h5` (v1 cloud) | `dba3ae0407342babb45d404436189abbd564f0131719370cfd66d17f82bf2481` |

## Ce qui n'est pas couvert

- Les modèles **Cloud** n'ont pas changé (toujours v1) : aucun v3 Cloud n'est
  produit. `restaurer-v1.sh` les recopie par sécurité ; `basculer-v3.sh` ne les
  touche pas.
- Le **plafond de confiance 0,995** est porté par `inference.py` et s'applique
  aux quatre services, cloud compris. Conséquence des scripts : `basculer-v3.sh`
  (code v3) **plafonne aussi le cloud**, `restaurer-v1.sh` (code v1) **retire le
  plafond** et peut donc réafficher « 100 % ». C'est le comportement d'origine de
  v1, pas un bug.
- La calibration (`TEMPERATURE_EDGE`) est codée en dur dans `inference.py`,
  alignée sur `kernels/kaggle/pn-edge-v3` et `tb-edge-v3`, **edge uniquement**.
  Tout réentraînement doit la remettre à jour depuis `metrics_*_edge_v3.json`.
