"""Endpoint principal de routage des radiographies vers Edge ou Cloud."""

from fastapi import APIRouter, File, Form, UploadFile

from app.logique_routage.selecteur_edge_cloud import decider_destination
from app.schemas.schemas_routage import ReponseRoutage

routeur_routage = APIRouter()


@routeur_routage.post("/analyser", response_model=ReponseRoutage)
async def router_et_analyser(
    fichier: UploadFile = File(...),
    force_destination: str | None = Form(default=None),
) -> ReponseRoutage:
    """Recoit une radiographie, decide ou la traiter, et retourne les resultats.

    Si force_destination est fourni ("edge" ou "cloud"), le routage automatique
    est ignore et l'inference est forcee vers la destination choisie.
    """
    contenu_image = await fichier.read()
    resultat = await decider_destination(contenu_image, force_destination)
    return resultat
