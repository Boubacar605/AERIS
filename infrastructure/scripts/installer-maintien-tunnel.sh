#!/bin/bash
# ============================================================
# AERIS — Installation des services de maintien du tunnel Funnel
# ============================================================
# Fait trois choses :
#   1. copie `assurer-tunnel.sh` (idempotent) -> /usr/local/sbin/aeris-assurer-tunnel
#   2. installe le SERVICE systemd (boot) :
#        aeris-funnel.service -> réapplique la config Funnel au BOOT
#                                (oneshot + Restart=on-failure : surveille
#                                les chutes et se relance jusqu'à succès)
#   3. installe le HOOK de reprise (sortie de veille) :
#        /etc/systemd/system-sleep/aeris-funnel -> appelé avec "post" par
#        systemd-system-sleep à chaque retour de veille
#
# Idempotent : réinstallable sans effet de bord.
#
# Usage : sudo bash infrastructure/scripts/installer-maintien-tunnel.sh
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SYSTEMD_DIR="$SCRIPT_DIR/../systemd"
CIBLE_SBIN="/usr/local/sbin/aeris-assurer-tunnel"
CIBLE_UNIT_DIR="/etc/systemd/system"
CIBLE_HOOK_DIR="/etc/systemd/system-sleep"
CIBLE_HOOK="$CIBLE_HOOK_DIR/aeris-funnel"

echo "============================================"
echo " AERIS — Installation du maintien du tunnel"
echo "============================================"

[ "$(id -u)" -eq 0 ] || { echo "ERREUR : lancer avec sudo."; exit 1; }

echo "[1/4] Copie du script de maintien..."
cp "$SCRIPT_DIR/assurer-tunnel.sh" "$CIBLE_SBIN"
chmod 0755 "$CIBLE_SBIN"
echo "  -> $CIBLE_SBIN"

echo "[2/4] Nettoyage de l'ancienne unité de reprise (obsolète)..."
# L'ancienne unité visait post-resume.target, inexistant sur ce systemd.
# Elle est remplacée par le hook system-sleep ci-dessous.
systemctl disable aeris-funnel-resume.service >/dev/null 2>&1 || true
rm -f "$CIBLE_UNIT_DIR/aeris-funnel-resume.service"
rm -f "$CIBLE_UNIT_DIR/post-resume.target.wants/aeris-funnel-resume.service" 2>/dev/null || true
echo "  (ancienne unité retirée)"

echo "[3/4] Installation du service de boot (aeris-funnel.service)..."
cp "$SYSTEMD_DIR/aeris-funnel.service" "$CIBLE_UNIT_DIR/aeris-funnel.service"
echo "  -> $CIBLE_UNIT_DIR/aeris-funnel.service"

echo "[3b/4] Installation du hook de sortie de veille..."
mkdir -p "$CIBLE_HOOK_DIR"
cp "$SYSTEMD_DIR/aeris-funnel-resume" "$CIBLE_HOOK"
chmod 0755 "$CIBLE_HOOK"
echo "  -> $CIBLE_HOOK"

echo "[4/4] Activation..."
systemctl daemon-reload
systemctl enable aeris-funnel.service >/dev/null
systemctl start aeris-funnel.service

echo ""
echo "============================================"
echo " INSTALLÉ. Vérification :"
echo "============================================"
if systemctl --quiet is-active aeris-funnel.service; then
    echo "  aeris-funnel.service  -> ACTIF (config Funnel maintenue)"
else
    echo "  aeris-funnel.service  -> échec, voir : journalctl -u aeris-funnel.service"
fi
echo "  hook veille            -> $CIBLE_HOOK (appelé avec 'post' par systemd-sleep)"
echo ""
echo "  Au prochain redémarrage / sortie de veille, la config Funnel"
echo "  sera rejouée automatiquement (idempotent, aucune intervention)."
echo ""