"""Endpoints de verification de sante et metriques systeme du service."""

import asyncio
import time
from pathlib import Path

import psutil
from fastapi import APIRouter

from app import ressources
from app.config import config

routeur_sante = APIRouter(tags=["Sante"])

DEMARRAGE = time.time()

CHEMIN_LATENCE_SIMULEE = Path("/tmp/latence-simulee-ms")


def _lire_latence_simulee_ms() -> float:
    """Retourne la latence simulee (ms) demandee pour les scenarios de charge."""
    try:
        return float(CHEMIN_LATENCE_SIMULEE.read_text().strip())
    except (OSError, ValueError):
        return 0.0


@routeur_sante.get("/sante")
async def verifier_sante() -> dict:
    """Verifie que le service est operationnel."""
    latence_simulee_ms = _lire_latence_simulee_ms()
    if latence_simulee_ms > 0:
        await asyncio.sleep(latence_simulee_ms / 1000)
    return {
        "statut": "ok",
        "service": "service-pneumonie",
        "mode": config.mode_deploiement,
        "uptime_secondes": round(time.time() - DEMARRAGE, 1),
    }


@routeur_sante.get("/metriques-systeme")
async def obtenir_metriques_systeme() -> dict:
    """Expose les metriques de ressources de la contenante.

    Utilise par le moteur de decision pour evaluer l'etat de l'Edge et
    decider du routage. La lecture se fait dans le cgroup du conteneur
    (source ``cgroup``) et non sur l'hote : sans cela, la limite
    ``--memory`` du profil Edge ne se reflete pas dans la mesure et la
    regle de saturation RAM reste inoperante. Le champ ``source`` indique
    le mode de mesure retenu.
    """
    cpu, source_cpu = ressources.cpu_pourcentage()
    ram_pourcentage, ram_utilisee_mb, ram_totale_mb, source_ram = ressources.ram_pourcentage()
    return {
        "cpu_pourcentage": cpu,
        "ram_pourcentage": ram_pourcentage,
        "ram_utilisee_mb": ram_utilisee_mb,
        "ram_totale_mb": ram_totale_mb,
        "disque_pourcentage": psutil.disk_usage("/").percent,
        "mode": config.mode_deploiement,
        "source": source_ram if source_ram == source_cpu else f"{source_ram}/{source_cpu}",
    }
