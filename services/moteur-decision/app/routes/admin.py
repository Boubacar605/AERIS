"""Routes d'administration : gestion des utilisateurs et des patients."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app import persistance
from app.authentification import exiger_role, hacher_mot_de_passe
from app.notification import envoyer_notification_resultat

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
    sexe: str | None = None
    annee_naissance: int | None = None
    note: str | None = None


class ModifierPatientRequete(BaseModel):
    nom_complet: str | None = None
    email: str | None = None
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
        sexe=requete.sexe,
        annee_naissance=requete.annee_naissance,
        note=requete.note,
    )
    return {
        "id_patient": patient.id_patient,
        "code_patient": patient.code_patient,
        "nom_complet": patient.nom_complet,
        "email": patient.email,
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
    """Genere un nouvel OTP et l'envoie par email au patient."""
    patient = await persistance.obtenir_patient_par_id(id_patient)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient introuvable")
    if not patient.email:
        raise HTTPException(status_code=400, detail="Patient sans email — impossible d'envoyer l'OTP")

    code = await persistance.generer_et_stocker_otp(
        id_patient=patient.id_patient,
        id_examen=None,
        email=patient.email,
    )
    await envoyer_notification_resultat(
        email_destination=patient.email,
        code_otp=code,
        nom_patient=patient.nom_complet,
    )
    return {"statut": "otp_envoye", "email": patient.email}
