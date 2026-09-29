"""Authentification JWT et dependances FastAPI pour le RBAC.

Fournit :
- hachage/verification des mots de passe (bcrypt via passlib)
- creation/decodage de JWT (access + refresh)
- dependances FastAPI ``exiger_authentification`` et ``exiger_role``
"""

import logging
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, Header, HTTPException
from passlib.context import CryptContext

from app.config import config

_logger = logging.getLogger("aeris.auth")

# ---------------------------------------------------------------------------
# Mots de passe
# ---------------------------------------------------------------------------

_contexte_mdp = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hacher_mot_de_passe(mot: str) -> str:
    """Retourne le hash bcrypt du mot de passe en clair."""
    return _contexte_mdp.hash(mot)


def verifier_mot_de_passe(mot: str, hash_attendu: str) -> bool:
    """Verifie un mot de passe contre son hash."""
    return _contexte_mdp.verify(mot, hash_attendu)


# ---------------------------------------------------------------------------
# JWT
# ---------------------------------------------------------------------------

def creer_jwt(payload: dict, ttl_minutes: int | None = None) -> str:
    """Cree un token JWT signe avec le secret de la config."""
    maintenant = datetime.now(timezone.utc)
    duree = timedelta(minutes=ttl_minutes or config.jwt_ttl_acces_minutes)
    corps = {
        **payload,
        "iat": maintenant,
        "exp": maintenant + duree,
    }
    return jwt.encode(corps, config.jwt_secret, algorithm="HS256")


def decoder_jwt(token: str) -> dict:
    """Decode et verifie un JWT. Levera JWTError en cas de token invalide."""
    return jwt.decode(token, config.jwt_secret, algorithms=["HS256"])


# ---------------------------------------------------------------------------
# Dependances FastAPI
# ---------------------------------------------------------------------------

# Import tardif pour eviter les imports circulaires
from app import persistance  # noqa: E402


async def exiger_authentification(
    authorization: str | None = Header(default=None),
):
    """Dependance FastAPI : extrait et verifie le Bearer token.

    Retourne l'objet ``Utilisateur`` ORM si le token est valide et actif.
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="En-tete Authorization manquant")

    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Format : Bearer <token>")

    token = authorization[7:]
    try:
        donnees = decoder_jwt(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expire")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token invalide")

    # Un token de rafraichissement (7 jours) ne doit jamais servir de Bearer :
    # il ouvrirait les routes protegees bien plus longtemps qu'un acces (30 min).
    # Le claim ``type`` est emis par /auth/connexion ; son absence reste toleree
    # pour les jetons anterieurs (compatibilite ascendante).
    type_token = donnees.get("type")
    if type_token is not None and type_token != "acces":
        raise HTTPException(status_code=401, detail="Type de token invalide")

    id_utilisateur = donnees.get("sub")
    if not id_utilisateur:
        raise HTTPException(status_code=401, detail="Token sans sujet (sub)")

    if not persistance.active():
        raise HTTPException(status_code=503, detail="Base de donnees indisponible")

    utilisateur = await persistance.obtenir_utilisateur_par_id(int(id_utilisateur))
    if not utilisateur:
        raise HTTPException(status_code=401, detail="Utilisateur introuvable")

    if not utilisateur.actif:
        raise HTTPException(status_code=403, detail="Compte desactive")

    return utilisateur


def exiger_role(*roles_permis: str):
    """Dependance factory : verifie que l'utilisateur a l'un des roles requis."""

    async def _dep(
        utilisateur=Depends(exiger_authentification),
    ):
        if utilisateur.role not in roles_permis:
            raise HTTPException(
                status_code=403,
                detail=f"Role '{utilisateur.role}' non autorise. Roles requis : {', '.join(roles_permis)}",
            )
        return utilisateur

    return _dep
