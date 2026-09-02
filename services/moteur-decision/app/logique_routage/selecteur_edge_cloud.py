"""Selecteur de destination Edge vs Cloud.

Logique centrale de decision : combine les metriques reseau et ressources
pour determiner ou executer l'inference, puis appelle les services
de diagnostic en parallele (tuberculose + pneumonie).

Regles de decision :
- Reseau INDISPONIBLE -> Edge (mode degrade, urgence)
- Latence reseau > seuil -> Edge (reseau trop lent)
- CPU Edge > seuil OU RAM Edge > seuil -> Cloud (Edge sature)
- Sinon -> Edge (par defaut, proximite des donnees)
"""

import asyncio
import logging
import time

import httpx

from app.config import config
from app.logique_routage.evaluateur_reseau import (
    mesurer_latence_cloud,
    verifier_connectivite_cloud,
)
from app.logique_routage.evaluateur_ressources import (
    obtenir_utilisation_cpu,
    obtenir_utilisation_ram,
)
from app.schemas.schemas_routage import (
    DecisionRoutage,
    MetriquesSysteme,
    ReponseRoutage,
    ResultatDiagnostic,
)

logger = logging.getLogger(__name__)

TIMEOUT_INFERENCE = 30.0


def _obtenir_urls(destination: str) -> tuple[str, str]:
    """Retourne les URLs des services TB et PN selon la destination."""
    if destination == "edge":
        return config.url_service_tb_edge, config.url_service_pn_edge
    return config.url_service_tb_cloud, config.url_service_pn_cloud


async def _appeler_service(
    client: httpx.AsyncClient, url: str, contenu_image: bytes, nom_service: str
) -> ResultatDiagnostic:
    """Appelle un service de diagnostic et retourne le resultat."""
    try:
        reponse = await client.post(
            f"{url}/diagnostic/analyser",
            files={"fichier": ("radiographie.png", contenu_image, "image/png")},
        )
        reponse.raise_for_status()
        donnees = reponse.json()
        return ResultatDiagnostic(
            pathologie=donnees["pathologie"],
            prediction=donnees["prediction"],
            confiance=donnees["confiance"],
            temps_inference_ms=donnees.get("temps_inference_ms", 0.0),
        )
    except (httpx.RequestError, httpx.HTTPStatusError) as e:
        logger.error("Erreur appel %s (%s) : %s", nom_service, url, e)
        return ResultatDiagnostic(
            pathologie=nom_service,
            prediction="erreur",
            confiance=0.0,
            temps_inference_ms=0.0,
        )


async def decider_destination(contenu_image: bytes) -> ReponseRoutage:
    """Decide ou envoyer l'image et execute l'inference en parallele."""
    debut = time.time()

    cpu, ram, reseau_ok = await asyncio.gather(
        obtenir_utilisation_cpu(),
        obtenir_utilisation_ram(),
        verifier_connectivite_cloud(),
    )

    latence = await mesurer_latence_cloud() if reseau_ok else 9999.0

    metriques = MetriquesSysteme(
        cpu_pourcentage=cpu,
        ram_pourcentage=ram,
        latence_reseau_ms=latence,
        reseau_disponible=reseau_ok,
    )

    destination, raison = _appliquer_regles(metriques)

    decision = DecisionRoutage(
        destination=destination,
        raison=raison,
        metriques=metriques,
    )

    logger.info("Decision : %s — %s", destination, raison)

    url_tb, url_pn = _obtenir_urls(destination)

    async with httpx.AsyncClient(timeout=TIMEOUT_INFERENCE) as client:
        resultat_tb, resultat_pn = await asyncio.gather(
            _appeler_service(client, url_tb, contenu_image, "tuberculose"),
            _appeler_service(client, url_pn, contenu_image, "pneumonie"),
        )

    temps_total = (time.time() - debut) * 1000

    logger.info(
        "Routage termine [%s] : TB=%s (%.2f), PN=%s (%.2f) — %sms",
        destination,
        resultat_tb.prediction,
        resultat_tb.confiance,
        resultat_pn.prediction,
        resultat_pn.confiance,
        round(temps_total, 2),
    )

    return ReponseRoutage(
        decision=decision,
        resultats=[resultat_tb, resultat_pn],
        temps_total_ms=round(temps_total, 2),
    )


def _appliquer_regles(metriques: MetriquesSysteme) -> tuple[str, str]:
    """Applique les regles de decision basees sur les seuils configures."""
    if not metriques.reseau_disponible:
        return "edge", "Reseau indisponible - traitement local d'urgence"

    if metriques.latence_reseau_ms > config.seuil_latence_ms:
        return "edge", (
            f"Latence reseau ({metriques.latence_reseau_ms}ms) "
            f"superieure au seuil ({config.seuil_latence_ms}ms)"
        )

    if metriques.cpu_pourcentage > config.seuil_cpu:
        return "cloud", (
            f"CPU Edge sature ({metriques.cpu_pourcentage}%) "
            f"- delegation au Cloud"
        )

    if metriques.ram_pourcentage > config.seuil_ram:
        return "cloud", (
            f"RAM Edge saturee ({metriques.ram_pourcentage}%) "
            f"- delegation au Cloud"
        )

    return "edge", "Conditions normales - traitement local privilegie"
