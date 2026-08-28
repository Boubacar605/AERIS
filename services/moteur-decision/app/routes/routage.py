"""Endpoint principal de routage des radiographies vers Edge ou Cloud."""

from fastapi import APIRouter, File, UploadFile

from app.logique_routage.selecteur_edge_cloud import decider_destination
from app.schemas.schemas_routage import ReponseRoutage

routeur_routage = APIRouter()


@routeur_routage.post("/analyser", response_model=ReponseRoutage)
async def router_et_analyser(fichier: UploadFile = File(...)) -> ReponseRoutage:
    """Recoit une radiographie, decide ou la traiter, et retourne les resultats.

    Le moteur evalue l'etat du systeme (CPU, RAM, reseau) et decide si
    l'inference doit etre executee localement (Edge) ou a distance (Cloud).
    """
    contenu_image = await fichier.read()
    resultat = await decider_destination(contenu_image)
    return resultat
