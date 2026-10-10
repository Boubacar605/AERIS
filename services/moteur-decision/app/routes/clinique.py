"""Routes du geste clinique : dossier patient et controles a venir (Vague 1).

Ce que le clinicien fait au quotidien, et qui n'a rien du journal technique :
retrouver un dossier, relire la chronologie d'un patient, comparer deux
examens, et savoir qui recontroler en priorité.

Ces routes sont reservees au role ``clinicien`` : l'administration des comptes
reste dans ``admin.py``, qui expose la meme notion de patient sous l'angle
gestion (creation, renvoi d'OTP) et non dossier de soins. Deux usages
reellement distincts, deux routes — pas de page conditionnee par role.
"""

import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError

from app import persistance
from app.authentification import exiger_role
from app.config import config
from app.recommandations import generer_recommandations, resumer_verdicts
from app.whatsapp import composer_message_compte_rendu, envoyer_message_whatsapp

routeur_clinique = APIRouter(tags=["Clinique"])

_logger = logging.getLogger("aeris.clinique")

# Champs de suivi acceptes : un statut d'echeance reste dans son perimetre.
_STATUTS_SUIVI = ("planifie", "realise", "annule")


def _exiger_base() -> None:
    if not persistance.active():
        raise HTTPException(status_code=503, detail="Base de donnees indisponible")


# ---------------------------------------------------------------------------
# Dossier patient
# ---------------------------------------------------------------------------


@routeur_clinique.get("/patients")
async def lister_dossiers(_=Depends(exiger_role("clinicien"))) -> list[dict]:
    """Liste les dossiers patients avec le dernier verdict et l'etat de
    validation, pour orienter la priorite du poste.

    Volontairement sans destination Edge/Cloud, ni latence, ni identifiant
    systeme : ces donnees appartiennent au journal technique (page Historique),
    reserve a l'admin.
    """
    _exiger_base()
    return await persistance.lister_dossiers_cliniques()


@routeur_clinique.get("/patients/{code_patient}")
async def lire_chronologie(code_patient: str, _=Depends(exiger_role("clinicien"))) -> dict:
    """Chronologie clinique d'un patient : tous ses examens, du plus recent au
    plus ancien, avec verdicts et etat de validation.

    La comparaison « dernier examen contre precedent » se fait cote client a
    partir de cette liste : aucun endpoint dedie n'est necessaire.
    """
    _exiger_base()
    patient = await persistance.obtenir_patient_par_code(code_patient)
    if patient is None:
        raise HTTPException(status_code=404, detail="Patient introuvable")
    chronologie = await persistance.chronologie_patient(patient.id_patient)
    if chronologie is None:
        raise HTTPException(status_code=404, detail="Patient introuvable")
    return chronologie


# ---------------------------------------------------------------------------
# Controles a venir
# ---------------------------------------------------------------------------


class CreerSuiviRequete(BaseModel):
    """Une date, un patient, un motif libre : pas de calendrier complexe."""

    id_patient: int
    date_suivi: date
    motif: str | None = Field(default=None, max_length=500)
    id_examen_origine: int | None = None


class StatutSuiviRequete(BaseModel):
    statut: str


@routeur_clinique.get("/suivis")
async def lister_suivis(
    limite: int = Query(default=200, ge=1, le=500),
    _=Depends(exiger_role("clinicien")),
) -> list[dict]:
    """Controles a venir, echeance la plus proche en premier."""
    _exiger_base()
    return await persistance.lister_suivis(limite)


@routeur_clinique.post("/suivis")
async def creer_suivi(requete: CreerSuiviRequete, _=Depends(exiger_role("clinicien"))) -> dict:
    """Programme un controle a venir pour un patient.

    L'examen d'origine est facultatif : un suivi peut venir de la page
    Resultat (examen connu) comme d'une saisie directe au poste.
    """
    _exiger_base()
    if await persistance.obtenir_patient_par_id(requete.id_patient) is None:
        raise HTTPException(status_code=404, detail="Patient introuvable")
    if requete.id_examen_origine is not None and (
        await persistance.patient_de_examen(requete.id_examen_origine) is None
    ):
        raise HTTPException(status_code=404, detail="Examen introuvable")

    try:
        suivi = await persistance.creer_suivi(
            id_patient=requete.id_patient,
            date_suivi=requete.date_suivi,
            motif=requete.motif,
            id_examen_origine=requete.id_examen_origine,
        )
    except SQLAlchemyError as exc:
        _logger.error("Suivi refuse pour le patient %s : %s", requete.id_patient, exc)
        raise HTTPException(status_code=503, detail="Suivi non enregistre") from exc
    return suivi


@routeur_clinique.patch("/suivis/{id_suivi}")
async def changer_statut_suivi(
    id_suivi: int,
    requete: StatutSuiviRequete,
    _=Depends(exiger_role("clinicien")),
) -> dict:
    """Marque un controle honore ou annule. Rien n'est supprime : la trace du
    poste reste consultable, seule l'echeance sort du triage."""
    _exiger_base()
    if requete.statut not in _STATUTS_SUIVI:
        raise HTTPException(
            status_code=422,
            detail="statut invalide : attendu 'planifie', 'realise' ou 'annule'",
        )
    if not await persistance.changer_statut_suivi(id_suivi, requete.statut):
        raise HTTPException(status_code=404, detail="Suivi introuvable")
    return {"id_suivi": id_suivi, "statut": requete.statut}


# ---------------------------------------------------------------------------
# File de triage
# ---------------------------------------------------------------------------


@routeur_clinique.get("/triage")
async def lire_file_triage(
    seuil_alerte_jours: int = Query(default=2, ge=0, le=60),
    _=Depends(exiger_role("clinicien")),
) -> dict:
    """Examens completes en attente de decision clinique, du plus ancien au
    plus recent.

    Une alerte est derivee du delai de validation : elle n'est ni stockee ni
    envoyee, elle se recalcule a chaque lecture. Le seuil est un parametre de la
    requete pour que le poste puisse l'ajuster sans redemarrer le service.
    """
    _exiger_base()
    return await persistance.lister_file_triage(seuil_alerte_jours)


# ---------------------------------------------------------------------------
# Recommandations et partage du compte rendu
# ---------------------------------------------------------------------------


@routeur_clinique.get("/recommandations/{id_examen}")
async def lire_recommandations(id_examen: int, _=Depends(exiger_role("clinicien"))) -> dict:
    """Orientations de prise en charge pour un examen, cote clinicien.

    Derivees des verdicts, jamais stockees : changer de modele change le texte
    au clic suivant, et aucune recommandation ne survit a un examen qui n'existe
    plus. Une recommandation n'est pas une prescription.
    """
    _exiger_base()
    if await persistance.patient_de_examen(id_examen) is None:
        raise HTTPException(status_code=404, detail="Examen introuvable")

    verdicts = await persistance.verdits_cliniques_examen(id_examen)
    if not verdicts:
        raise HTTPException(
            status_code=409,
            detail="Cet examen n'a aucun verdict : rien a recommander",
        )

    validation = await persistance.etat_validation(id_examen)
    recommandations = generer_recommandations(verdicts, valide=validation["statut"] == "approuve")
    return {
        "id_examen": id_examen,
        "validation": validation,
        "recommandations": [
            {
                "texte": reco.texte,
                "cible": reco.cible,
                "motif": reco.motif,
                "pathologie": reco.pathologie,
                "confiance": reco.confiance,
                "tags": reco.tags,
            }
            for reco in recommandations
        ],
    }


@routeur_clinique.post("/examens/{id_examen}/partager")
async def partager_compte_rendu(id_examen: int, _=Depends(exiger_role("clinicien"))) -> dict:
    """Envoie au patient, sur WhatsApp, le resume de son compte rendu valide.

    Deux refus deliberes :

    * examen non approuve — on ne transmet pas par WhatsApp un resultat qu'un
      clinicien n'a pas arrete, meme provisoirement ;
    * patient sans WhatsApp possible — le compte rendu reste lisible par le
      portail, l'absence de canal n'est pas une erreur serveur.
    """
    _exiger_base()

    patient = await persistance.patient_de_examen(id_examen)
    if patient is None:
        raise HTTPException(status_code=404, detail="Examen introuvable")

    validation = await persistance.etat_validation(id_examen)
    if validation["statut"] != "approuve":
        raise HTTPException(
            status_code=409,
            detail=(
                "Compte rendu non partage : l'examen doit etre approuve avant "
                "d'etre transmis au patient"
            ),
        )

    dossier = await persistance.obtenir_patient_par_id(patient)
    if dossier is None or not dossier.telephone:
        raise HTTPException(
            status_code=409,
            detail="Partage impossible : ce patient n'a pas de telephone enregistre",
        )

    # Le message renvoie au portail en demandant d'utiliser le code de
    # consultation. Ne pas l'envoyer si aucun code n'a jamais abouti chez le
    # patient (SMTP ou relais tombe a l'approbation) : mieux vaut un refus
    # explicite qu'une promesse de code inexistant.
    if not await persistance.existe_otp_actif_patient(patient):
        raise HTTPException(
            status_code=409,
            detail=(
                "Partage impossible : aucun code de consultation actif pour ce "
                "patient. Renvoyez-lui d'abord son code OTP depuis la gestion des "
                "patients, puis partagez le resume."
            ),
        )

    verdicts = await persistance.verdits_cliniques_examen(id_examen)
    resume = resumer_verdicts(verdicts)
    recommandations = [
        reco.texte
        for reco in generer_recommandations(verdicts, valide=True)
        if reco.cible == "patient"
    ]
    message = composer_message_compte_rendu(
        nom_patient=dossier.nom_complet,
        resume=resume,
        recommandations=recommandations,
        url=config.url_tableau_de_bord.rstrip("/"),
    )
    envoye = await envoyer_message_whatsapp(dossier.telephone, message)
    if not envoye:
        raise HTTPException(
            status_code=502,
            detail="Le relais WhatsApp n'a pas accepte le message. Le compte rendu reste lisible par le portail patient.",
        )
    return {
        "id_examen": id_examen,
        "canal": "whatsapp",
        "envoye": True,
        "simulation": not config.whatsapp_url_relay,
        "nb_recommandations": len(recommandations),
    }


@routeur_clinique.get("/protocole")
async def lire_protocole(_=Depends(exiger_role("clinicien"))) -> dict:
    """Agregats de la file pour la page Statistiques (Vague 2).

    Volontairement sans destination Edge/Cloud ni latence : ces chiffres
    relevent de la page Monitoring, reservee a l'admin. Ici on ne parle que de
    charge de travail et de decisions cliniques.
    """
    _exiger_base()
    agregats = await persistance.protocole_validation()
    if agregats is None:
        raise HTTPException(
            status_code=503,
            detail="Statistiques indisponibles : la base de donnees ne repond pas",
        )
    return agregats


# ---------------------------------------------------------------------------
# Synthese du poste (tableau de bord clinicien)
# ---------------------------------------------------------------------------


@routeur_clinique.get("/poste/synthese")
async def lire_synthese_poste(
    seuil_alerte_jours: int = Query(default=2, ge=0, le=60),
    _=Depends(exiger_role("clinicien")),
) -> dict:
    """Vue d'ensemble du poste, en une seule lecture.

    Un seul agregat plutot qu'un agregat par page : six requetes
    HTTP produiraient six instantanes differents du meme etat, et deux
    chiffres du tableau de bord pourraient se contredire d'un affichage a
    l'autre. Ici tout provient d'une session, donc d'une lecture coherente.

    Le seuil d'alerte est le meme parametre que celui de ``/triage`` : les
    deux pages doivent compter la meme file avec la meme regle.

    Aucun champ technique n'est expose ici — ni destination Edge/Cloud, ni
    CPU, RAM ou latence. Ces indicateurs restent reserves a l'admin ; le
    test de frontiere clinique verifie que la forme de la reponse ne peut
    pas y deriver.
    """
    _exiger_base()
    try:
        return await persistance.synthese_poste(seuil_alerte_jours)
    except SQLAlchemyError as exc:
        _logger.error("Synthese du poste indisponible : %s", exc)
        raise HTTPException(status_code=503, detail="Synthese du poste indisponible") from exc
