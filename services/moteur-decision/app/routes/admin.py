"""Routes d'administration : gestion des utilisateurs et des patients."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app import persistance
from app.authentification import exiger_role, hacher_mot_de_passe
from app.notification import envoyer_notification_otp
from app.whatsapp import normaliser_numero

routeur_admin = APIRouter(prefix="/admin", tags=["Administration"])


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
    code_patient: str
    nom_complet: str | None = None
    email: str | None = None
    telephone: str | None = None
    sexe: str | None = None
    annee_naissance: int | None = None
    note: str | None = None


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
    """Cree un nouveau patient (necessaire pour l'envoi OTP)."""
    patient = await persistance.creer_patient(
        code_patient=requete.code_patient,
        nom_complet=requete.nom_complet,
        email=requete.email,
        telephone=requete.telephone,
        sexe=requete.sexe,
        annee_naissance=requete.annee_naissance,
        note=requete.note,
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
    return {
        "statut": "otp_envoye" if envoye["ok"] else "echec_envoi",
        "canal": envoye["canal"],
        "contact": contact,
    }
