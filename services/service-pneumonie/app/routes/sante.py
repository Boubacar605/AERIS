"""Endpoints de verification de sante et metriques systeme du service."""

import time

import psutil
from fastapi import APIRouter

from app.config import config

routeur_sante = APIRouter(tags=["Sante"])

DEMARRAGE = time.time()


@routeur_sante.get("/sante")
async def verifier_sante() -> dict:
    """Verifie que le service est operationnel."""
    return {
        "statut": "ok",
        "service": "service-pneumonie",
        "mode": config.mode_deploiement,
        "uptime_secondes": round(time.time() - DEMARRAGE, 1),
    }


@routeur_sante.get("/metriques-systeme")
async def obtenir_metriques_systeme() -> dict:
    """Expose les metriques de ressources du conteneur/noeud.

    Utilise par le moteur de decision pour evaluer l'etat de l'Edge
    et decider du routage.
    """
    memoire = psutil.virtual_memory()
    return {
        "cpu_pourcentage": psutil.cpu_percent(interval=0.1),
        "ram_pourcentage": memoire.percent,
        "ram_utilisee_mb": round(memoire.used / (1024 * 1024), 1),
        "ram_totale_mb": round(memoire.total / (1024 * 1024), 1),
        "mode": config.mode_deploiement,
    }
