"""Endpoint principal de routage des radiographies vers Edge ou Cloud."""

import hashlib
import logging
from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError

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


class FichePatientTrouvee(BaseModel):
    """Fiche existante retrouvee a partir du seul numero de telephone."""

    trouve: bool
    id_patient: int | None = None
    code_patient: str | None = None
    nom: str | None = None
    prenom: str | None = None
    nom_complet: str | None = None
    email: str | None = None
    date_naissance: date | None = None
    telephone_normalise: str | None = None


@routeur_routage.get("/patient", response_model=FichePatientTrouvee)
async def rechercher_patient_par_telephone_route(
    telephone: str,
    _utilisateur=Depends(exiger_role("clinicien")),
) -> FichePatientTrouvee:
    """Retrouve la fiche existante correspondant a un numero de telephone.

    Appele par le formulaire « Diagnostic » pendant la saisie : si le numero
    est deja connu, l'interface reprend l'identite du patient pour eviter de
    ressaisir a la main et surtout pour rattacher l'examen a la bonne fiche.

    Cette lecture ne cree rien et ne modifie rien : la validation reste
    explicite (bouton « Enregistrer le patient »), et le refus de
    rattachement a une autre identite reste applique par POST /routage/patient.
    """
    numero = normaliser_numero(telephone)
    if not numero:
        # Saisie encore en cours (fewer than one digit) : pas une erreur.
        return FichePatientTrouvee(trouve=False)

    patient = await persistance.rechercher_patient_par_telephone(telephone)
    if patient is None:
        return FichePatientTrouvee(trouve=False)

    _logger.info(
        "Fiche existante retrouvee par telephone (%s) — pre-remplissage propose",
        patient.code_patient,
    )
    return FichePatientTrouvee(
        trouve=True,
        id_patient=patient.id_patient,
        code_patient=patient.code_patient,
        # Les fiches d'avant la séparation nom/prenom n'ont que nom_complet :
        # on renvoie alors l'affichage, et le formulaire ne l'ignore pas.
        nom=patient.nom or None,
        prenom=patient.prenom or None,
        nom_complet=patient.nom_complet,
        email=patient.email,
        date_naissance=patient.date_naissance,
        telephone_normalise=numero,
    )


@routeur_routage.post("/analyser", response_model=ReponseRoutage)
async def router_et_analyser(
    fichier: UploadFile = File(...),
    force_destination: str | None = Form(default=None),
    contexte: str | None = Form(default=None),
    code_patient: str | None = Form(default=None),
    second_avis: bool | None = Form(default=None),
    _utilisateur=Depends(exiger_role("clinicien")),
) -> ReponseRoutage:
    """Recoit une radiographie, decide ou la traiter, et retourne les resultats.

    Si force_destination est fourni ("edge" ou "cloud"), le routage automatique
    est ignore et l'inference est forcee vers la destination choisie : aucun
    appel n'est emis vers l'autre source, afin que la mesure reste fidele a
    la destination annoncee. Passer second_avis=true pour reactiver le
    controle qualite croise malgre la destination forcee.

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
        second_avis=second_avis,
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

    # Poignee de l'examen (Vague 1) : la ligne examens_image est ecrite ici,
    # en une transaction courte, pour que l'approbation du clinicien puisse
    # s'adresser a un examen precis. Les verdicts et le diagnostic restent
    # flushes par le worker : preparer_examen absorbe toute erreur et renvoie
    # None, l'analyse est servie dans tous les cas.
    id_examen = await persistance.preparer_examen(
        id_patient=patient_cible.id_patient if patient_cible else None,
        nom_fichier=fichier.filename or "inconnu",
        hash_contenu=hashlib.sha256(contenu_image).hexdigest(),
        taille_octets=len(contenu_image),
    )

    # Persistance durable : jamais bloquante ; soit la file est consommée par
    # le worker, soit l'écriture est simplement ignorée (persistance inactive).
    # id_patient relie l'examen au sujet réel (sinon le patient technique).
    _ = persistance.soumettre_diagnostic(
        {
            "id_patient": patient_cible.id_patient if patient_cible else None,
            "id_examen": id_examen,
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

    return ReponseRoutage(
        decision=resultat.decision,
        resultats=resultat.resultats,
        escalades=resultat.escalades,
        temps_total_ms=resultat.temps_total_ms,
        temps_escalade_ms=resultat.temps_escalade_ms,
        filtrage=resultat.filtrage,
        id_examen=id_examen,
    )


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

    Securite : le dedoublonnage ne doit jamais rattacher un examen a la
    fiche d'un autre patient. Si le telephone existe mais que l'identite
    (nom/prenom) differe, on refuse l'enregistrement (409) au lieu de
    renvoyer silencieusement un dossier etrang — meme traitement pour un
    email deja associe a un autre patient.
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

    email = requete.email.strip().lower() if requete.email else None

    existant = await persistance.rechercher_patient_par_telephone(requete.telephone)
    if existant is not None:
        if not _meme_identite(existant, nom, prenom):
            _logger.warning(
                "Conflit d'identite sur le telephone %s : fiche « %s » != saisie « %s %s » "
                "— enregistrement refuse",
                normaliser_numero(requete.telephone),
                # getattr : les fiches anciennes n'ont pas les colonnes
                # nom/prenom (seul nom_complet est renseigne).
                getattr(existant, "nom_complet", None) or "identite inconnue",
                prenom,
                nom,
            )
            raise HTTPException(
                status_code=409,
                detail=(
                    "Ce numero de telephone est deja rattache a un autre patient. "
                    "Verifiez l'identite saisie, utilisez un autre numero, ou "
                    "selectionnez le dossier existant pour retrouver ses resultats."
                ),
            )
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

    if email:
        par_email = await persistance.rechercher_patient_par_email(email)
        if par_email is not None:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Cet email est deja associe a un autre patient. "
                    "Utilisez le dossier existant ou une autre adresse."
                ),
            )

    try:
        patient = await persistance.creer_patient(
            nom=nom,
            prenom=prenom,
            email=email,
            telephone=requete.telephone,
            date_naissance=requete.date_naissance,
        )
    except IntegrityError as exc:
        # Filet de securite : deux requetes concurrentes peuvent franchir
        # la verification applicative avant que la contrainte unique ne
        # tombe. On traduit alors l'integrite en 409 explicite.
        _logger.warning("Conflit d'unicite a l'enregistrement du patient : %s", exc)
        raise HTTPException(
            status_code=409,
            detail="Patient deja enregistre (telephone ou email deja utilise)",
        ) from exc
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


def _meme_identite(patient, nom: str, prenom: str) -> bool:
    """Compare l'identite saisie a celle du dossier existant.

    Comparaison insensible a la casse et aux espaces : « niang » et
    « NIANG  » designent la meme personne. Une difference de nom ou de
    prenom est un conflit et bloque l'enregistrement.

    Les fiches anterieures a la separation nom/prenom (migration 0004) n'ont
    que ``nom_complet`` : on compare alors la forme concatenee, sinon tout
    re-enregistrement d'un patient historique serait refuse a tort.
    """

    def _normaliser(valeur: str | None) -> str:
        return " ".join((valeur or "").split()).casefold()

    nom_existant = _normaliser(getattr(patient, "nom", None))
    prenom_existant = _normaliser(getattr(patient, "prenom", None))

    if nom_existant or prenom_existant:
        return nom_existant == _normaliser(nom) and prenom_existant == _normaliser(prenom)

    return _normaliser(getattr(patient, "nom_complet", None)) == _normaliser(
        " ".join(part for part in (prenom, nom) if part)
    )
