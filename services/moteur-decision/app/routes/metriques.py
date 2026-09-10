"""Endpoint d'exposition des metriques systeme en temps reel.

Fournit au tableau de bord l'etat complet du systeme :
ressources Edge, connectivite Cloud, debit temps reel, et
l'historique des derniers diagnostics realises par le moteur.
"""

import asyncio
import time
from typing import Annotated

import httpx
from fastapi import APIRouter, Query

from app.config import config
from app.logique_routage.evaluateur_reseau import (
    mesurer_latence_cloud,
    verifier_connectivite_cloud,
)
from app.logique_routage.evaluateur_ressources import obtenir_metriques_completes
from app.logique_routage.registre_diagnostics import (
    CAPACITE_HISTORIQUE,
    metriques_temps_reel,
    obtenir_derniers_diagnostics,
    statistiques,
)
from app.logique_routage.selecteur_edge_cloud import _appliquer_regles
from app.schemas.schemas_routage import MetriquesSysteme

routeur_metriques = APIRouter(tags=["Metriques"])


@routeur_metriques.get("/etat-systeme")
async def obtenir_etat_systeme() -> dict:
    """Retourne l'etat complet du systeme pour le tableau de bord.

    La decision de routage temps reel est calculee a partir des metriques
    deja collectees (aucun appel reseau supplementaire) via les memes regles
    que le moteur pour l'inference. Les statistiques d'historique fournissent
    la repartition Edge/Cloud des requetes reelles.
    """
    metriques_edge, connectivite, latence = await asyncio.gather(
        obtenir_metriques_completes(),
        verifier_connectivite_cloud(),
        _mesurer_latence_securisee(),
    )

    metriques = MetriquesSysteme(
        cpu_pourcentage=metriques_edge.get("cpu_pourcentage", 0.0),
        ram_pourcentage=metriques_edge.get("ram_pourcentage", 0.0),
        latence_reseau_ms=latence,
        reseau_disponible=connectivite,
    )
    destination, raison = _appliquer_regles(metriques)

    return {
        "edge": metriques_edge,
        "cloud": {
            "connectivite": connectivite,
            "latence_ms": latence,
        },
        "tempreel": metriques_temps_reel(),
        "statistiques": statistiques(),
        "decision": {
            "destination": destination,
            "raison": raison,
            "metriques": metriques.model_dump(),
        },
    }


@routeur_metriques.get("/historique")
async def obtenir_historique(
    limite: Annotated[int, Query(ge=1, le=500)] = CAPACITE_HISTORIQUE,
) -> dict:
    """Retourne les derniers diagnostics realises par le moteur.

    Le buffer circulaire conserve au maximum les ``CAPACITE_HISTORIQUE``
    diagnostics les plus recents (defaut : 100). Les statistiques accompagnent
    la liste pour alimenter directement les compteurs du tableau de bord.
    """
    return {
        "derniers_diagnostics": obtenir_derniers_diagnostics(limite),
        "statistiques": statistiques(),
    }


@routeur_metriques.get("/sante-services")
async def obtenir_sante_services() -> dict:
    """Interroge la sante de chaque service IA (TB/PN x Edge/Cloud).

    Appelle GET /sante sur les 4 conteneurs de services et retourne
    l'etat de chacun. Les services injoignables sont marques "deconnecte".
    """
    services = {
        "tb_edge": config.url_service_tb_edge,
        "tb_cloud": config.url_service_tb_cloud,
        "pn_edge": config.url_service_pn_edge,
        "pn_cloud": config.url_service_pn_cloud,
    }

    async def _ping_service(nom: str, url: str) -> dict:
        debut = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                rep = await client.get(f"{url}/sante")
                rep.raise_for_status()
                donnees = rep.json()
                return {
                    "nom": nom,
                    "statut": donnees.get("statut", "inconnu"),
                    "mode": donnees.get("mode", "inconnu"),
                    "uptime_secondes": donnees.get("uptime_secondes", 0),
                    "latence_ms": round((time.monotonic() - debut) * 1000, 1),
                }
        except Exception:
            return {
                "nom": nom,
                "statut": "deconnecte",
                "mode": "inconnu",
                "uptime_secondes": 0,
                "latence_ms": round((time.monotonic() - debut) * 1000, 1),
            }

    resultats = await asyncio.gather(
        *[_ping_service(nom, url) for nom, url in services.items()],
    )

    return {r["nom"]: r for r in resultats}


async def _mesurer_latence_securisee() -> float:
    """Mesure la latence en gerant le cas ou le Cloud est injoignable."""
    try:
        return await mesurer_latence_cloud()
    except Exception:
        return 9999.0