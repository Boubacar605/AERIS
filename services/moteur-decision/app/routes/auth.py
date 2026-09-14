"""Routes d'authentification : connexion, token, info utilisateur."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app import persistance
from app.authentification import (
    creer_jwt,
    decoder_jwt,
    exiger_authentification,
    verifier_mot_de_passe,
)

routeur_auth = APIRouter(prefix="/auth", tags=["Authentification"])


class ConnexionRequete(BaseModel):
    email: str
    mot_de_passe: str


class ConnexionReponse(BaseModel):
    acces_token: str
    rafraichissement_token: str
    personne: dict


class RafraichirRequete(BaseModel):
    rafraichissement_token: str


@routeur_auth.post("/connexion", response_model=ConnexionReponse)
async def connecter(requete: ConnexionRequete) -> ConnexionReponse:
    """Authentifie un utilisateur et retourne les tokens JWT."""
    if not persistance.active():
        raise HTTPException(status_code=503, detail="Base de donnees indisponible")

    utilisateur = await persistance.obtenir_utilisateur_par_email(requete.email)
    if not utilisateur:
        raise HTTPException(status_code=401, detail="Email ou mot de passe incorrect")

    if not verifier_mot_de_passe(requete.mot_de_passe, utilisateur.mot_de_passe_hash):
        raise HTTPException(status_code=401, detail="Email ou mot de passe incorrect")

    if not utilisateur.actif:
        raise HTTPException(status_code=403, detail="Compte desactive")

    acces = creer_jwt(
        {"sub": str(utilisateur.id_utilisateur), "role": utilisateur.role, "type": "acces"},
    )
    rafraichissement = creer_jwt(
        {"sub": str(utilisateur.id_utilisateur), "role": utilisateur.role, "type": "rafraichissement"},
        ttl_minutes=7 * 24 * 60,  # 7 jours
    )

    return ConnexionReponse(
        acces_token=acces,
        rafraichissement_token=rafraichissement,
        personne={
            "id_utilisateur": utilisateur.id_utilisateur,
            "email": utilisateur.email,
            "nom": utilisateur.nom,
            "prenom": utilisateur.prenom,
            "role": utilisateur.role,
        },
    )


@routeur_auth.get("/moi")
async def obtenir_moi(utilisateur=Depends(exiger_authentification)) -> dict:
    """Retourne les informations de l'utilisateur authentifie."""
    return {
        "id_utilisateur": utilisateur.id_utilisateur,
        "email": utilisateur.email,
        "nom": utilisateur.nom,
        "prenom": utilisateur.prenom,
        "role": utilisateur.role,
        "actif": utilisateur.actif,
    }


@routeur_auth.post("/rafraichir")
async def rafraichir_token(requete: RafraichirRequete) -> dict:
    """Rafraichit un access token a partir d'un refresh token valide."""
    try:
        donnees = decoder_jwt(requete.rafraichissement_token)
    except Exception:
        raise HTTPException(status_code=401, detail="Refresh token invalide")

    if donnees.get("type") != "rafraichissement":
        raise HTTPException(status_code=401, detail="Ce n'est pas un refresh token")

    id_utilisateur = int(donnees["sub"])
    utilisateur = await persistance.obtenir_utilisateur_par_id(id_utilisateur)
    if not utilisateur or not utilisateur.actif:
        raise HTTPException(status_code=401, detail="Utilisateur introuvable ou desactive")

    acces = creer_jwt(
        {"sub": str(utilisateur.id_utilisateur), "role": utilisateur.role, "type": "acces"},
    )
    return {"acces_token": acces}
