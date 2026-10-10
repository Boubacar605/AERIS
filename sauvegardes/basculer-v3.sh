#!/usr/bin/env bash
# Remet en service les modeles Edge v3 (plafond de confiance 0,995, convention
# PN Edge corrigee : sortie = P(PNEUMONIE)).
#
# Usage : bash sauvegardes/basculer-v3.sh
#
# Le code est cuit dans l'image Docker : la bascule reconstruit donc les images
# Edge apres avoir copie les .h5 et le code v3.
set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SAUV="$RACINE/sauvegardes"

echo "== Empreintes des modeles v3 sauvegardes =="
( cd "$SAUV/modeles-v3" && sha256sum -c SHA256SUMS.txt 2>/dev/null || echo "  (pas de SHA256SUMS, on continue)" )

echo "== Copie des modeles Edge v3 =="
cp "$SAUV/modeles-v3/aeris_pn_edge_v3.h5" "$RACINE/services/service-pneumonie/modeles_entraines/modele_pneumonie.h5"
cp "$SAUV/modeles-v3/aeris_tb_edge_v3.h5" "$RACINE/services/service-tuberculose/modeles_entraines/modele_tuberculose.h5"

echo "== Copie du code v3 (calibration bornee, convention PN corrigee) =="
cp "$SAUV/code-v3/inference-pneumonie-v3.py"   "$RACINE/services/service-pneumonie/app/coeur/inference.py"
cp "$SAUV/code-v3/inference-tuberculose-v3.py" "$RACINE/services/service-tuberculose/app/coeur/inference.py"

echo "== Reconstruction des images Edge =="
( cd "$RACINE" && docker compose --profile edge up -d --build service-pneumonie-edge service-tuberculose-edge )

echo "== Termine : services Edge v3 en place =="
docker ps --filter name=aeris-pn-edge --filter name=aeris-tb-edge --format '{{.Names}}  {{.Status}}'
