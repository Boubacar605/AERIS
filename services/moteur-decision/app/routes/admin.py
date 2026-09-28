"""Routes d'administration : gestion des utilisateurs et des patients.

Le flux « Approuver » de la page Résultat (POST /admin/examens/approuver) y
vit aussi : il est ouvert au role clinicien, contrairement au reste du panel.
"""

import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app import persistance
from app.authentification import exiger_role, hacher_mot_de_passe
from app.notification import envoyer_notification_otp
from app.whatsapp import normaliser_numero

routeur_admin = APIRouter(prefix="/admin", tags=["Administration"])

_logger = logging.getLogger("aeris.admin")


# ---------------------------------------------------------------------------
# Utilisateurs
# ---------------------------------------------------------------------------

class CreerUtilisateurRequete(BaseModel):
    email: str
    nom: str
    prenom: str
    role: str  # "admin" | "clinicien"
    mot_de_passe: str


class ModifierUtilisateurRequete(BaseModel):
    actif: bool | None = None
    role: str | None = None
    mot_de_passe: str | None = None


@routeur_admin.get("/utilisateurs")
async def lister_utilisateurs(
    _=Depends(exiger_role("admin")),
) -> list[dict]:
    """Liste tous les utilisateurs (admin et cliniciens)."""
    return await persistance.lister_utilisateurs()


@routeur_admin.post("/utilisateurs")
async def creer_utilisateur(
    requete: CreerUtilisateurRequete,
    _=Depends(exiger_role("admin")),
) -> dict:
    """Cree un nouvel utilisateur (admin ou clinicien)."""
    if requete.role not in ("admin", "clinicien"):
        raise HTTPException(status_code=422, detail="Role invalide : 'admin' ou 'clinicien'")

    existant = await persistance.obtenir_utilisateur_par_email(requete.email)
    if existant:
        raise HTTPException(status_code=409, detail="Cet email est deja utilise")

    hash_mdp = hacher_mot_de_passe(requete.mot_de_passe)
    utilisateur = await persistance.creer_utilisateur(
        email=requete.email,
        nom=requete.nom,
        prenom=requete.prenom,
        role=requete.role,
        mot_de_passe_hash=hash_mdp,
    )
    return {
        "id_utilisateur": utilisateur.id_utilisateur,
        "email": utilisateur.email,
        "nom": utilisateur.nom,
        "prenom": utilisateur.prenom,
        "role": utilisateur.role,
        "actif": utilisateur.actif,
    }


@routeur_admin.patch("/utilisateurs/{id_utilisateur}")
async def modifier_utilisateur(
    id_utilisateur: int,
    requete: ModifierUtilisateurRequete,
    _=Depends(exiger_role("admin")),
) -> dict:
    """Modifie le statut, le role ou le mot de passe d'un utilisateur."""
    if requete.role and requete.role not in ("admin", "clinicien"):
        raise HTTPException(status_code=422, detail="Role invalide")

    if requete.actif is not None:
        await persistance.activer_desactiver_utilisateur(id_utilisateur, requete.actif)

    # TODO: modifier role / mot de passe si necessaire
    return {"statut": "modifie"}


# ---------------------------------------------------------------------------
# Patients
# ---------------------------------------------------------------------------

class CreerPatientRequete(BaseModel):
    """Patient cree en admin : le code AER-AAAA-NNNN est genere automatiquement
    s'il n'est pas fourni (flux patient automatique), et le numero de telephone
    est la cle de dedoublonnage (index unique partiel)."""

    code_patient: str | None = None
    nom_complet: str | None = None
    email: str | None = None
    telephone: str | None = None
    sexe: str | None = None
    annee_naissance: int | None = None
    note: str | None = None
    nom: str | None = None
    prenom: str | None = None
    date_naissance: str | None = None


class ModifierPatientRequete(BaseModel):
    nom_complet: str | None = None
    email: str | None = None
    telephone: str | None = None
    sexe: str | None = None
    annee_naissance: int | None = None
    note: str | None = None


@routeur_admin.get("/patients")
async def lister_patients(
    _=Depends(exiger_role("admin")),
) -> list[dict]:
    """Liste tous les patients enregistres."""
    return await persistance.lister_patients()


@routeur_admin.post("/patients")
async def creer_patient(
    requete: CreerPatientRequete,
    _=Depends(exiger_role("admin")),
) -> dict:
    """Cree un nouveau patient (necessaire pour l'envoi OTP).

    Le code patient est genere automatiquement (AER-AAAA-NNNN) s'il n'est pas
    fourni. Un numero de telephone deja enregistre est refuse (dedoublonnage)
    : reutilisez le patient existant via la page Diagnostic.
    """
    if requete.telephone:
        numero = normaliser_numero(requete.telephone)
        existant = await persistance.rechercher_patient_par_telephone(numero)
        if existant is not None:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Patient deja enregistre avec ce telephone "
                    f"({existant.code_patient})"
                ),
            )
    else:
        numero = None

    date_naissance = None
    if requete.date_naissance:
        try:
            date_naissance = date.fromisoformat(requete.date_naissance)
        except ValueError:
            raise HTTPException(
                status_code=422, detail="date_naissance invalide (format AAAA-MM-JJ)"
            )

    patient = await persistance.creer_patient(
        code_patient=requete.code_patient,
        nom_complet=requete.nom_complet,
        email=requete.email,
        telephone=numero,
        sexe=requete.sexe,
        annee_naissance=requete.annee_naissance,
        note=requete.note,
        nom=requete.nom,
        prenom=requete.prenom,
        date_naissance=date_naissance,
    )
    return {
        "id_patient": patient.id_patient,
        "code_patient": patient.code_patient,
        "nom_complet": patient.nom_complet,
        "email": patient.email,
        "telephone": patient.telephone,
    }


@routeur_admin.patch("/patients/{id_patient}")
async def modifier_patient(
    id_patient: int,
    requete: ModifierPatientRequete,
    _=Depends(exiger_role("admin")),
) -> dict:
    """Modifie les informations d'un patient."""
    # TODO: implementer la modification
    return {"statut": "modifie"}


@routeur_admin.post("/patients/{id_patient}/renvoyer-otp")
async def renvoyer_otp(
    id_patient: int,
    _=Depends(exiger_role("admin")),
) -> dict:
    """Genere un nouvel OTP et l'envoie au patient (WhatsApp ou email)."""
    patient = await persistance.obtenir_patient_par_id(id_patient)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient introuvable")

    # Le contact est le téléphone (canal WhatsApp) s'il existe, sinon l'email.
    contact = patient.telephone or patient.email
    if not contact:
        raise HTTPException(
            status_code=400,
            detail="Patient sans telephone ni email — impossible d'envoyer l'OTP",
        )

    # L'OTP est stocké avec le contact sous sa forme normalisée (le code est
    # vérifié contre la saisie du patient, elle-même normalisée côté acces.py).
    # Le numéro brut reste affiché à l'admin via `contact`.
    destination = normaliser_numero(patient.telephone) if patient.telephone else patient.email
    destination = destination or contact

    code = await persistance.generer_et_stocker_otp(
        id_patient=patient.id_patient,
        id_examen=None,
        destination=destination,
    )
    envoye = await envoyer_notification_otp(patient, code)
    return _reponse_envoi(envoye, contact)


class ValidationExamenRequete(BaseModel):
    """Decision du clinicien sur un examen precis.

    ``id_examen`` et non le code patient : l'approbation porte sur un compte
    rendu, pas sur une personne. C'est ce qui permet de rattacher la decision
    a l'OTP envoye et de le revoquer en cas de desaccord.
    """

    id_examen: int
    note_clinique: str | None = None


class DesapprobationExamenRequete(BaseModel):
    id_examen: int
    motif_desaccord: str = Field(min_length=1)


@routeur_admin.post("/examens/approuver")
async def approuver_examen(
    requete: ValidationExamenRequete,
    utilisateur=Depends(exiger_role("clinicien")),
) -> dict:
    """Valide l'examen : la notification OTP part alors.

    C'est le declencheur du flux patient : le code est genere et envoye par
    email + WhatsApp si le patient a une adresse email, sinon par WhatsApp
    seul (envoyer_notification_otp choisi les canaux). Le code + le lien de
    la page « consultation resultats » sont inclus dans chaque message.

    L'OTP est emis **pour cet examen** (et non plus sans lien, comme avant la
    Vague 1) et la decision est journalisee : sans elle, aucun desaccord
    ulterieur ne pourrait etre trace ni revoquer.
    """
    if not persistance.active():
        raise HTTPException(status_code=503, detail="Base de donnees indisponible")

    id_patient = await _patient_de_examen(requete.id_examen)
    patient = await persistance.obtenir_patient_par_id(id_patient)
    if patient is None:
        raise HTTPException(status_code=404, detail="Patient introuvable")

    contact = patient.telephone or patient.email
    if not contact:
        raise HTTPException(
            status_code=400,
            detail="Patient sans telephone ni email — impossible d'envoyer l'OTP",
        )

    destination = normaliser_numero(patient.telephone) if patient.telephone else patient.email
    code, id_otp = await persistance.emettre_otp_pour_examen(
        id_patient=patient.id_patient,
        id_examen=requete.id_examen,
        destination=destination,
    )
    validation = await persistance.enregistrer_validation(
        id_examen=requete.id_examen,
        statut="approuve",
        id_utilisateur=utilisateur.id_utilisateur,
        note_clinique=requete.note_clinique,
        id_otp=id_otp,
    )
    envoye = await envoyer_notification_otp(patient, code)
    _logger.info(
        "Examen %s approuve pour %s — OTP envoye sur %s (canaux ok : %s)",
        requete.id_examen,
        patient.code_patient,
        envoye.get("canal", "aucun"),
        ", ".join(envoye.get("canaux_oks") or []) or "aucun",
    )
    for avertissement in envoye.get("avertissements") or []:
        _logger.warning("OTP %s : %s", patient.code_patient, avertissement)
    return {**_reponse_envoi(envoye, contact), "validation": validation}


@routeur_admin.post("/examens/desapprouver")
async def desapprouver_examen(
    requete: DesapprobationExamenRequete,
    utilisateur=Depends(exiger_role("clinicien")),
) -> dict:
    """Refuse le compte rendu et retire au patient l'acces au code envoye.

    Le desaccord est obligatoire : c'est lui qui rend la decision relisible plus
    tard, et le journal est **en ajout** — une reapprobation ulterieure n'ecrase
    pas ce motif.

    Sans la revocation des OTP deja emis, ce bouton n'aurait aucun effet : le
    code est permanent et reutilisable, le patient continuerait de lire le
    resultat que le clinicien vient de refuser.
    """
    if not persistance.active():
        raise HTTPException(status_code=503, detail="Base de donnees indisponible")

    id_patient = await _patient_de_examen(requete.id_examen)
    validation = await persistance.enregistrer_validation(
        id_examen=requete.id_examen,
        statut="desapprouve",
        id_utilisateur=utilisateur.id_utilisateur,
        motif_desaccord=requete.motif_desaccord,
    )
    revoques = await persistance.revoquer_otp(requete.id_examen)
    _logger.info(
        "Examen %s desapprouve (patient %s) — %s OTP revoque(s)",
        requete.id_examen,
        id_patient,
        revoques,
    )
    return {
        "statut": "desapprouve",
        "otp_revoques": revoques,
        "validation": validation,
    }


async def _patient_de_examen(id_examen: int) -> int:
    """Patient rattache a un examen, 404 si l'examen n'existe pas."""
    id_patient = await persistance.patient_de_examen(id_examen)
    if id_patient is None:
        raise HTTPException(
            status_code=404,
            detail="Examen introuvable — l'analyse n'a peut-etre pas ete conservee",
        )
    return id_patient


def _reponse_envoi(envoye: dict, contact: str) -> dict:
    """Traduit le verdict par canal en reponse HTTP comprehensible.

    Le statut distingue l'echec total de la livraison partielle : si un
    seul canal a abouti, l'OTP est bien parti et la reponse doit le dire,
    sans masquer le compteur en panne derriere un « echec_envoi ».

    Les details par canal sont lus de facon tolerante (``get``) : l'examen
    est deja approuve en base a ce stade, une forme de retour incomplete ne
    doit donc pas transformer l'approbation en erreur 500 — l'appelant
    (``envoyer_notification_otp``) reste la seule source de verite.
    """
    canaux = dict(envoye.get("canaux") or {})
    canaux_oks = list(envoye.get("canaux_oks") or [])
    avertissements = list(envoye.get("avertissements") or [])
    ok = bool(envoye.get("ok"))

    if not ok:
        statut = "echec_envoi"
    elif canaux and len(canaux_oks) < len(canaux):
        statut = "otp_partiellement_envoye"
    else:
        statut = "otp_envoye"
    return {
        "statut": statut,
        "canal": envoye.get("canal", "aucun"),
        "contact": contact,
        "canaux": canaux,
        "canaux_oks": canaux_oks,
        "avertissements": avertissements,
    }
