"""Endpoint d'exposition des metriques systeme en temps reel.

Fournit au tableau de bord l'etat complet du systeme :
ressources Edge, connectivite Cloud, et derniere decision de routage.
"""

import asyncio

from fastapi import APIRouter

from app.logique_routage.evaluateur_reseau import (
    mesurer_latence_cloud,
    verifier_connectivite_cloud,
)
from app.logique_routage.evaluateur_ressources import obtenir_metriques_completes

routeur_metriques = APIRouter(tags=["Metriques"])


@routeur_metriques.get("/etat-systeme")
async def obtenir_etat_systeme() -> dict:
    """Retourne l'etat complet du systeme pour le tableau de bord."""
    metriques_edge, connectivite, latence = await asyncio.gather(
        obtenir_metriques_completes(),
        verifier_connectivite_cloud(),
        _mesurer_latence_securisee(),
    )

    return {
        "edge": metriques_edge,
        "cloud": {
            "connectivite": connectivite,
            "latence_ms": latence,
        },
    }


async def _mesurer_latence_securisee() -> float:
    """Mesure la latence en gerant le cas ou le Cloud est injoignable."""
    try:
        return await mesurer_latence_cloud()
    except Exception:
        return 9999.0
