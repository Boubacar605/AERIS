#!/bin/bash
# ============================================================
# AERIS — Configuration du tunnel Tailscale Funnel
# ============================================================
# Ce script :
#   1. Installe et configure nginx (reverse proxy unifie)
#   2. Configure Tailscale Serve (frontend + backend sur un seul port)
#   3. Active Tailscale Funnel (URL publique permanente)
#
# Pre-requis :
#   - sudo tailscale up (deja fait, auth completee)
#   - Tous les services Docker en cours (moteur, tableau-de-bord)
#
# Usage : bash infrastructure/scripts/configurer-tunnel.sh
# ============================================================

set -euo pipefail

PORT_NGINX=8080
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NGINX_CONF="$SCRIPT_DIR/../nginx/aeris.conf"

echo "============================================"
echo " AERIS — Configuration Tunnel Tailscale"
echo "============================================"
echo ""

# --- 1. Verifier que Tailscale est connecte ---
echo "[1/5] Verification de Tailscale..."
if ! tailscale status >/dev/null 2>&1; then
    echo "ERREUR : Tailscale n'est pas connecte."
    echo "  Lance : sudo tailscale up"
    echo "  Puis relance ce script."
    exit 1
fi
HOSTNAME_TAILSCALE=$(tailscale status --self=true --peers=false --json | python3 -c "import sys,json; print(json.load(sys.stdin)['Self']['DNSName'].rstrip('.'))")
echo "  Tailscale connecte : $HOSTNAME_TAILSCALE"
echo ""

# --- 2. Installer et configurer nginx ---
echo "[2/5] Installation de nginx..."
if ! command -v nginx >/dev/null 2>&1; then
    sudo apt-get update -qq
    sudo apt-get install -y -qq nginx >/dev/null
    echo "  nginx installe."
else
    echo "  nginx deja installe."
fi

echo "[3/5] Configuration de nginx (reverse proxy unifie)..."
sudo cp "$NGINX_CONF" /etc/nginx/sites-available/aeris
sudo ln -sf /etc/nginx/sites-available/aeris /etc/nginx/sites-enabled/aeris
# Desactiver la config par defaut si elle existe
sudo rm -f /etc/nginx/sites-enabled/default
# Tester et recharger
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl enable nginx
echo "  nginx actif sur le port $PORT_NGINX"
echo ""

# --- 3. Verifier que nginx repond ---
echo "[4/5] Test du reverse proxy..."
sleep 1
if curl -sf "http://127.0.0.1:$PORT_NGINX/" >/dev/null 2>&1; then
    echo "  Frontend joignable via nginx."
else
    echo "  ATTENTION : frontend non joignable. Verifie que les conteneurs Docker tournent."
fi
if curl -sf "http://127.0.0.1:$PORT_NGINX/api/sante" >/dev/null 2>&1; then
    echo "  Backend joignable via nginx."
else
    echo "  ATTENTION : backend non joignable. Verifie que moteur-decision tourne."
fi
echo ""

# --- 4. Configurer Tailscale Serve + Funnel ---
echo "[5/5] Configuration de Tailscale Funnel..."

# Piège connu : `tailscale funnel --bg 443` (sans cible) ECRASE le handler
# racine vers le port 443 local, cassant le proxy du frontend (boucle -> 502).
# Il faut donc configurer CHAQUE cible via `tailscale funnel --set-path=...`
# directement, en une seule passe.

# Servir le frontend (port 3000) sur la racine, expose publiquement
tailscale funnel --bg --set-path=/ --https=443 "http://127.0.0.1:3000"
echo "  Frontend servi sur https://$HOSTNAME_TAILSCALE/"

# Ajouter le backend sur /api/, expose publiquement
tailscale funnel --bg --set-path=/api --https=443 "http://127.0.0.1:8003"
echo "  Backend route vers https://$HOSTNAME_TAILSCALE/api/"
echo ""

echo "============================================"
echo " TUNNEL CONFIGURE !"
echo "============================================"
echo ""
echo "  URL PUBlique : https://$HOSTNAME_TAILSCALE/"
echo ""
echo "  Frontend : https://$HOSTNAME_TAILSCALE/"
echo "  Backend  : https://$HOSTNAME_TAILSCALE/api/routage/analyser"
echo ""
echo "  Cette URL est PERMANENTE — elle ne change jamais,"
echo "  meme apres un redemarrage ou une mise en veille."
echo ""
echo "  Pour verifier : tailscale funnel status"
echo "  Pour arreter   : tailscale funnel --https=443 off"
echo ""
