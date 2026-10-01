"""Evaluation de l'etat du reseau (latence, disponibilite).

Mesure la connectivite vers les services Cloud via des requetes HTTP
pour alimenter la decision de routage.
"""

import asyncio
import logging
import time

import httpx

from app.config import config

logger = logging.getLogger(__name__)

TIMEOUT_CONNECTIVITE = 3.0

# Une retentative courte absorbe un faux negatif transitoire sans masquer une
# vraie panne : lors d'un arret massif de conteneurs (scenario panne), le DNS
# embarque de Docker reindexe les noms pendant quelques secondes et peut faire
# echouer une seule sonde Cloud pourtant joignable.
RETENTATIVE_CONNECTIVITE = 1
DELAI_RETENTATIVE_S = 0.5


async def mesurer_latence_cloud() -> float:
    """Mesure la latence reseau vers le service Cloud TB (endpoint /sante)."""
    url = f"{config.url_service_tb_cloud}/sante"
    for tentative in range(RETENTATIVE_CONNECTIVITE + 1):
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_CONNECTIVITE) as client:
                debut = time.time()
                reponse = await client.get(url)
                if reponse.status_code != 200:
                    raise httpx.RequestError("Code HTTP inattendu", request=reponse.request)
                latence = (time.time() - debut) * 1000
                return round(latence, 2)
        except (httpx.RequestError, httpx.TimeoutException) as e:
            logger.warning(
                "Mesure de latence echouee vers %s (tentative %d/%d) : %s",
                url,
                tentative + 1,
                RETENTATIVE_CONNECTIVITE + 1,
                e,
            )
            if tentative < RETENTATIVE_CONNECTIVITE:
                await asyncio.sleep(DELAI_RETENTATIVE_S)
    return 9999.0


async def verifier_connectivite_cloud() -> bool:
    """Verifie si les services Cloud sont joignables."""
    url = f"{config.url_service_tb_cloud}/sante"
    for tentative in range(RETENTATIVE_CONNECTIVITE + 1):
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_CONNECTIVITE) as client:
                reponse = await client.get(url)
                return reponse.status_code == 200
        except (httpx.RequestError, httpx.TimeoutException) as e:
            logger.warning(
                "Cloud injoignable a %s (tentative %d/%d) : %s",
                url,
                tentative + 1,
                RETENTATIVE_CONNECTIVITE + 1,
                e,
            )
            if tentative < RETENTATIVE_CONNECTIVITE:
                await asyncio.sleep(DELAI_RETENTATIVE_S)
    return False
