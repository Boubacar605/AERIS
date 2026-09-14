"""Endpoint principal de routage des radiographies vers Edge ou Cloud."""

import hashlib
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app import persistance
from app.authentification import exiger_role
from app.logique_routage.registre_diagnostics import (
    enregistrer_diagnostic,
    incrementer_compteur,
)
from app.logique_routage.selecteur_edge_cloud import decider_destination
from app.notification import envoyer_notification_resultat
from app.schemas.schemas_routage import ReponseRoutage

routeur_routage = APIRouter()


@routeur_routage.post("/analyser", response_model=ReponseRoutage)
async def router_et_analyser(
    fichier: UploadFile = File(...),
    force_destination: str | None = Form(default=None),
    contexte: str | None = Form(default=None),
    code_patient: str | None = Form(default=None),
    _utilisateur=Depends(exiger_role("clinicien")),
) -> ReponseRoutage:
    """Recoit une radiographie, decide ou la traiter, et retourne les resultats.

    Si force_destination est fourni ("edge" ou "cloud"), le routage automatique
    est ignore et l'inference est forcee vers la destination choisie.

    L'eventuel contexte clinique ("tuberculose", "pneumonie" ou "general")
    surclasse le profilage automatique : il restreint ou elargit le choix
    des specialistes sollicites.

    Si code_patient est fourni, un OTP est envoye par email au patient apres
    l'analyse pour lui permettre de consulter ses resultats.
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

    # Patient désigné par code_patient (résolu une seule fois) : sert à la fois
    # à rattacher l'examen au vrai sujet et à déclencher la notification OTP.
    patient_cible = None
    if code_patient and persistance.active():
        patient_cible = await persistance.obtenir_patient_par_code(code_patient)

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
    # id_patient relie l'examen au sujet réel (sinon le patient technique).
    _ = persistance.soumettre_diagnostic(
        {
            "id_patient": patient_cible.id_patient if patient_cible else None,
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

    # Notification patient par OTP si code_patient fourni
    if patient_cible and patient_cible.email:
        code_otp = await persistance.generer_et_stocker_otp(
            id_patient=patient_cible.id_patient,
            id_examen=None,
            email=patient_cible.email,
        )
        await envoyer_notification_resultat(
            email_destination=patient_cible.email,
            code_otp=code_otp,
            nom_patient=patient_cible.nom_complet,
        )

    return resultat
