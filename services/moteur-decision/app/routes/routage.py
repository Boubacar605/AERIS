"""Endpoint principal de routage des radiographies vers Edge ou Cloud."""

import hashlib

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app import persistance
from app.logique_routage.registre_diagnostics import (
    enregistrer_diagnostic,
    incrementer_compteur,
)
from app.logique_routage.selecteur_edge_cloud import decider_destination
from app.schemas.schemas_routage import ReponseRoutage

routeur_routage = APIRouter()


@routeur_routage.post("/analyser", response_model=ReponseRoutage)
async def router_et_analyser(
    fichier: UploadFile = File(...),
    force_destination: str | None = Form(default=None),
    contexte: str | None = Form(default=None),
) -> ReponseRoutage:
    """Recoit une radiographie, decide ou la traiter, et retourne les resultats.

    Si force_destination est fourni ("edge" ou "cloud"), le routage automatique
    est ignore et l'inference est forcee vers la destination choisie.

    L'eventuel contexte clinique ("tuberculose", "pneumonie" ou "general")
    surclasse le profilage automatique : il restreint ou elargit le choix
    des specialistes sollicites.
    """
    if contexte is not None and contexte not in ("tuberculose", "pneumonie", "general"):
        raise HTTPException(
            status_code=422,
            detail="contexte invalide : attendu 'tuberculose', 'pneumonie' ou 'general'",
        )

    contenu_image = await fichier.read()
    resultat = await decider_destination(
        contenu_image,
        force_destination,
        contexte=contexte,
        nom_fichier=fichier.filename,
    )

    incrementer_compteur()
    enregistrer_diagnostic(
        destination=resultat.decision.destination,
        resultats=[r.model_dump() for r in resultat.resultats],
        temps_total_ms=resultat.temps_total_ms,
        escalades=[e.model_dump() for e in resultat.escalades],
        filtrage=resultat.filtrage.model_dump() if resultat.filtrage else None,
    )

    # Persistance durable : jamais bloquante ; soit la file est consommée par
    # le worker, soit l'écriture est simplement ignorée (persistance inactive).
    _ = persistance.soumettre_diagnostic(
        {
            "nom_fichier": fichier.filename,
            "hash_contenu": hashlib.sha256(contenu_image).hexdigest(),
            "taille_octets": len(contenu_image),
            "contexte": contexte or "auto",
            "destination": resultat.decision.destination,
            "raison": resultat.decision.raison,
            "metriques": resultat.decision.metriques.model_dump(),
            "temps_total_ms": resultat.temps_total_ms,
            "temps_escalade_ms": resultat.temps_escalade_ms,
            "statut": "completed",
            "resultats": [r.model_dump() for r in resultat.resultats],
            "escalades": [e.model_dump() for e in resultat.escalades],
            "filtrage": resultat.filtrage.model_dump() if resultat.filtrage else None,
        }
    )
    return resultat
