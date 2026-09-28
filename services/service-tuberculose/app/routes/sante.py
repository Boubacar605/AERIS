"""Endpoints de verification de sante et metriques systeme du service."""

import time

import psutil
from fastapi import APIRouter

from app import ressources
from app.config import config

routeur_sante = APIRouter(tags=["Sante"])

DEMARRAGE = time.time()


@routeur_sante.get("/sante")
async def verifier_sante() -> dict:
    """Verifie que le service est operationnel."""
    return {
        "statut": "ok",
        "service": "service-tuberculose",
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
