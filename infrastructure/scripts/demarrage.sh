#!/bin/bash
# Script de demarrage local du projet AERIS
# Usage: ./infrastructure/scripts/demarrage.sh [profil]
# Profils disponibles: complet, cloud, edge, monitoring

set -e

PROFIL=${1:-complet}

echo "=== AERIS — Demarrage ==="
echo "Profil: $PROFIL"
echo ""

if [ ! -f .env ]; then
    echo "Fichier .env absent. Creation depuis .env.example..."
    cp .env.example .env
fi

echo "Lancement des services (profil: $PROFIL)..."
docker compose --profile "$PROFIL" up -d

echo ""
echo "=== Services demarres ==="
docker compose ps

echo ""
echo "URLs disponibles:"
echo "  - Moteur de Decision : http://localhost:8003"
echo "  - Service TB (Cloud) : http://localhost:8001"
echo "  - Service PN (Cloud) : http://localhost:8002"
echo "  - Prometheus         : http://localhost:9090"
echo "  - Tableau de Bord    : http://localhost:3000"
