#!/usr/bin/env bash
# Remet en service les modeles v1 (pneumonie/tuberculose, edge + cloud) et le
# code v1 associe.
#
# Usage : bash sauvegardes/restaurer-v1.sh
#
# Pourquoi le code aussi : la convention de sortie du modele PN Edge a change.
# v1 sort P(NORMAL) et s'interprete avec `score < 0.5 = PNEUMONIE`, tandis que
# v3 sort P(PNEUMONIE) avec `score >= 0.5`. Restaurer les .h5 sans restaurer le
# code donnerait des verdicts inverses. Ce script restaure les deux, puis
# reconstruit les images Edge (le code est cuit dans l'image, pas monte).
set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SAUV="$RACINE/sauvegardes"

echo "== Empreintes des modeles v1 sauvegardes =="
( cd "$SAUV/modeles-v1" && sha256sum -c SHA256SUMS.txt )

echo "== Copie des modeles v1 =="
cp "$SAUV/modeles-v1/modele_pneumonie.h5"         "$RACINE/services/service-pneumonie/modeles_entraines/modele_pneumonie.h5"
cp "$SAUV/modeles-v1/modele_pneumonie_cloud.h5"   "$RACINE/services/service-pneumonie/modeles_entraines/modele_pneumonie_cloud.h5"
cp "$SAUV/modeles-v1/modele_tuberculose.h5"       "$RACINE/services/service-tuberculose/modeles_entraines/modele_tuberculose.h5"
cp "$SAUV/modeles-v1/modele_tuberculose_cloud.h5" "$RACINE/services/service-tuberculose/modeles_entraines/modele_tuberculose_cloud.h5"

echo "== Copie du code v1 (restaure la convention PN Edge inversee) =="
cp "$SAUV/code-v1/inference-pneumonie-v1.py"   "$RACINE/services/service-pneumonie/app/coeur/inference.py"
cp "$SAUV/code-v1/inference-tuberculose-v1.py" "$RACINE/services/service-tuberculose/app/coeur/inference.py"

echo "== Reconstruction des images Edge =="
( cd "$RACINE" && docker compose --profile edge up -d --build service-pneumonie-edge service-tuberculose-edge )

echo "== Termine : services v1 en place =="
docker ps --filter name=aeris-pn-edge --filter name=aeris-tb-edge --format '{{.Names}}  {{.Status}}'
