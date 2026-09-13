#!/bin/bash
# ============================================================
# AERIS — Maintien automatique du tunnel Tailscale Funnel
# ============================================================
# Idempotent : peut être rejoué à volonté (boot, sortie de veille,
# reconfig manuelle) sans casser le fonctionnement actif.
#
# Piège connu (documenté, cf. mémoire + ADR-0004) : `tailscale funnel
# --bg 443` SANS cible écrase le handler racine et boucle le proxy.
# On n'utilise donc JAMAIS la forme nue : chaque cible passe par
# `--set-path=`, les deux dans la même passe.
#
# Cibles (alignées sur le déploiement ACTUEL, sans nginx) :
#   /    -> http://127.0.0.1:3000   (frontend TanStack Start)
#   /api -> http://127.0.0.1:8003   (moteur de décision FastAPI)
# ============================================================

set -euo pipefail

PORT_FRONTEND=3000
PORT_BACKEND=8003
HTTPS=443
HOTE_A_CHECQUER="http://127.0.0.1"
ATTENTE_MAX_S=180        # temps max pour que tailscaled + Docker répondent
ATTENTE_PAS_S=5

echo "============================================"
echo " AERIS — Maintien du tunnel Funnel"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================"
echo ""

# --- 0. Déjà au point ? Sortie rapide sans rien perturber ---
statut_funnel() {
    tailscale funnel status 2>/dev/null || true
}
deja_config() {
    local statut
    statut="$(statut_funnel)"
    printf '%s' "$statut" | grep -qF "proxy http://127.0.0.1:$PORT_FRONTEND" &&
        printf '%s' "$statut" | grep -qF "proxy http://127.0.0.1:$PORT_BACKEND"
}

# --- 1. Attendre que tailscaled soit prêt ---
echo "[1/4] En attente de Tailscale..."
t0=$SECONDS
until tailscale status >/dev/null 2>&1; do
    [ $((SECONDS - t0)) -ge "$ATTENTE_MAX_S" ] && { echo "  ERREUR : tailscaled injoignable."; exit 1; }
    sleep "$ATTENTE_PAS_S"
done
echo "  Tailscale prêt."
echo ""

# --- 2. Attendre que les ports du frontend et du backend écoutent ---
echo "[2/4] En attente des services locaux (frontend $PORT_FRONTEND, backend $PORT_BACKEND)..."
t0=$SECONDS
until curl -sf --max-time 2 "$HOTE_A_CHECQUER:$PORT_FRONTEND/" >/dev/null 2>&1 &&
      curl -sf --max-time 2 "$HOTE_A_CHECQUER:$PORT_BACKEND/sante" >/dev/null 2>&1; do
    [ $((SECONDS - t0)) -ge "$ATTENTE_MAX_S" ] && {
        echo "  ERREUR : services Docker pas prêts après ${ATTENTE_MAX_S}s."
        echo "  (vérifie : docker compose --profile complet up -d)"
        exit 1;
    }
    sleep "$ATTENTE_PAS_S"
done
echo "  Frontend et backend joignables."
echo ""

# --- 3. Funnel déjà correctement configuré ? ---
echo "[3/4] Vérification de la config Funnel..."
if deja_config; then
    echo "  Config Funnel déjà en place, aucune modification nécessaire."
else
    echo "  Config Funnel absente ou incomplète — application..."
    # Chaque cible via --set-path, jamais la forme nue (piège ADR-0004)
    tailscale funnel --bg --set-path=/ --https=$HTTPS "http://127.0.0.1:$PORT_FRONTEND"
    tailscale funnel --bg --set-path=/api --https=$HTTPS "http://127.0.0.1:$PORT_BACKEND"
    echo "  Cibles / et /api appliquées."
fi
echo ""

# --- 4. Vérification finale ---
echo "[4/4] Vérification finale..."
if deja_config; then
    echo "  OK : tunnel maintenu."
    echo "  URL : $(tailscale status --self=true --peers=false --json | python3 -c 'import sys,json; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))' 2>/dev/null || echo '<machine>')"
else
    echo "  ATTENTION : la config Funnel ne correspond pas aux cibles attendues."
    tailscale funnel status 2>&1 || true
    exit 1
fi
echo ""