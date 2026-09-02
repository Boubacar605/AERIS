"""Evaluation de l'etat du reseau (latence, disponibilite).

Mesure la connectivite vers les services Cloud via des requetes HTTP
pour alimenter la decision de routage.
"""

import logging
import time

import httpx

from app.config import config

logger = logging.getLogger(__name__)

TIMEOUT_CONNECTIVITE = 3.0


async def mesurer_latence_cloud() -> float:
    """Mesure la latence reseau vers le service Cloud TB (endpoint /sante)."""
    url = f"{config.url_service_tb_cloud}/sante"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_CONNECTIVITE) as client:
            debut = time.time()
            await client.get(url)
            latence = (time.time() - debut) * 1000
            return round(latence, 2)
    except (httpx.RequestError, httpx.TimeoutException) as e:
        logger.warning("Mesure de latence echouee vers %s : %s", url, e)
        return 9999.0


async def verifier_connectivite_cloud() -> bool:
    """Verifie si les services Cloud sont joignables."""
    url = f"{config.url_service_tb_cloud}/sante"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_CONNECTIVITE) as client:
            reponse = await client.get(url)
            return reponse.status_code == 200
    except (httpx.RequestError, httpx.TimeoutException):
        logger.warning("Cloud injoignable a %s", url)
        return False
