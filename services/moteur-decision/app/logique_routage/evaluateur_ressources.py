"""Evaluation des ressources materielles de l'Edge (CPU, RAM).

Interroge les services Edge via leur endpoint /metriques-systeme
pour obtenir les metriques reelles du noeud Edge (pas celles du
moteur de decision lui-meme).

En cas d'echec de communication, retourne des valeurs elevees
pour forcer le routage vers le Cloud (mode securitaire).
"""

import logging

import httpx

from app.config import config

logger = logging.getLogger(__name__)

TIMEOUT = 2.0

_cache_metriques: dict = {}


async def _interroger_metriques_edge() -> dict:
    """Interroge le service TB Edge pour obtenir les metriques du noeud."""
    global _cache_metriques
    url = f"{config.url_service_tb_edge}/metriques-systeme"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            reponse = await client.get(url)
            reponse.raise_for_status()
            _cache_metriques = reponse.json()
            return _cache_metriques
    except (httpx.RequestError, httpx.HTTPStatusError) as e:
        logger.warning("Impossible de collecter les metriques Edge depuis %s : %s", url, e)
        if _cache_metriques:
            logger.info("Utilisation du cache des dernieres metriques Edge connues")
            return _cache_metriques
        return {"cpu_pourcentage": 99.0, "ram_pourcentage": 99.0}


async def obtenir_utilisation_cpu() -> float:
    """Obtient le pourcentage d'utilisation CPU du noeud Edge."""
    metriques = await _interroger_metriques_edge()
    return metriques.get("cpu_pourcentage", 99.0)


async def obtenir_utilisation_ram() -> float:
    """Obtient le pourcentage d'utilisation RAM du noeud Edge."""
    metriques = await _interroger_metriques_edge()
    return metriques.get("ram_pourcentage", 99.0)


async def obtenir_metriques_completes() -> dict:
    """Retourne toutes les metriques du noeud Edge."""
    return await _interroger_metriques_edge()
