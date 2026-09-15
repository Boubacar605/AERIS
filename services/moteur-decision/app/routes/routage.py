"""Endpoint principal de routage des radiographies vers Edge ou Cloud."""

import hashlib
import logging
from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app import persistance
from app.authentification import exiger_role
from app.logique_routage.registre_diagnostics import (
    enregistrer_diagnostic,
    incrementer_compteur,
)
from app.logique_routage.selecteur_edge_cloud import decider_destination
from app.schemas.schemas_routage import ReponseRoutage
from app.whatsapp import normaliser_numero

routeur_routage = APIRouter()

_logger = logging.getLogger("aeris.routage")


class EnTetePatientRequete(BaseModel):
    """En-tête patient rempli par le clinicien avant l'upload et le traitement.

    nom, prenom et telephone sont obligatoires ; email et date_naissance sont
    optionnels (la notification OTP sera envoyee a l'approbation).
    """

    nom: str
    prenom: str
    date_naissance: date | None = None
    email: str | None = None
    telephone: str


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

    code_patient (cree via POST /routage/patient, avant l'upload) rattache
    l'examen au sujet reel : la notification OTP, elle, n'est declenchee que
    par l'approbation du clinicien (POST /admin/examens/approuver).
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

    # Patient désigné par code_patient (résolu une seule fois) : rattache
    # l'examen au vrai sujet. La notification OTP est déclenchée plus tard,
    # à l'approbation du clinicien.
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

    return resultat


@routeur_routage.post("/patient")
async def enregistrer_en_tete_patient(
    requete: EnTetePatientRequete,
    _utilisateur=Depends(exiger_role("clinicien")),
) -> dict:
    """Cree (ou retrouve) le patient des l'en-tete de la page Diagnostic.

    Dedoublonnage par telephone (forme normalisee, index unique) : un numero
    deja enregistre reutilise le compte existant (``deja_enregistre: true``)
    au lieu de cree un doublon. Le code AER-AAAA-NNNN est generee par le
    systeme ; aucune saisie manuelle requise.
    """
    if not persistance.active():
        raise HTTPException(status_code=503, detail="Base de donnees indisponible")

    nom = requete.nom.strip()
    prenom = requete.prenom.strip()
    if not nom or not prenom:
        raise HTTPException(status_code=422, detail="Nom et prenom requis")
    if not normaliser_numero(requete.telephone):
        raise HTTPException(
            status_code=422, detail="Numero de telephone invalide (chiffres requis)"
        )

    existant = await persistance.rechercher_patient_par_telephone(requete.telephone)
    if existant is not None:
        _logger.info(
            "Patient deja enregistre (telephone) — compte reutilise : %s",
            existant.code_patient,
        )
        return {
            "id_patient": existant.id_patient,
            "code_patient": existant.code_patient,
            "nom_complet": existant.nom_complet,
            "deja_enregistre": True,
        }

    patient = await persistance.creer_patient(
        nom=nom,
        prenom=prenom,
        email=requete.email.strip().lower() if requete.email else None,
        telephone=requete.telephone,
        date_naissance=requete.date_naissance,
    )
    _logger.info(
        "Patient cree avec un code automatique : %s (%s %s)",
        patient.code_patient,
        prenom,
        nom,
    )
    return {
        "id_patient": patient.id_patient,
        "code_patient": patient.code_patient,
        "nom_complet": patient.nom_complet,
        "deja_enregistre": False,
    }
