"""Tests de l'authentification JWT : connexion, endpoints protégés, refresh."""

from __future__ import annotations

import types

import pytest
from fastapi.testclient import TestClient

from app import persistance
from app.authentification import hacher_mot_de_passe


def _utilisateur(
    id_: int = 1, role: str = "admin", email: str = "admin@aeris.local",
    mot_de_passe: str | None = None,
) -> types.SimpleNamespace:
    return types.SimpleNamespace(
        id_utilisateur=id_,
        email=email,
        nom="Niang",
        prenom="Boubacar",
        role=role,
        actif=True,
        mot_de_passe_hash=hacher_mot_de_passe(mot_de_passe or "SuperMotDePasse2026"),
    )


def test_connexion_reussie_retourne_tokens(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    """Email + mot de passe corrects -> deux tokens JWT et la personne."""

    async def _obtenir_par_email(email: str):
        return _utilisateur(email=email)

    monkeypatch.setattr(persistance, "obtenir_utilisateur_par_email", _obtenir_par_email)

    reponse = client.post(
        "/auth/connexion",
        json={"email": "admin@aeris.local", "mot_de_passe": "SuperMotDePasse2026"},
    )
    assert reponse.status_code == 200
    donnees = reponse.json()
    assert donnees["acces_token"]
    assert donnees["rafraichissement_token"]
    assert donnees["personne"]["role"] == "admin"
    assert donnees["personne"]["email"] == "admin@aeris.local"


def test_connexion_mauvais_mot_de_passe_refuse(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    """Mauvais mot de passe -> 401 sans leak du motif."""

    async def _obtenir_par_email(email: str):
        return _utilisateur(email=email)

    monkeypatch.setattr(persistance, "obtenir_utilisateur_par_email", _obtenir_par_email)

    reponse = client.post(
        "/auth/connexion",
        json={"email": "admin@aeris.local", "mot_de_passe": "MauvaisMotDePasse"},
    )
    assert reponse.status_code == 401
    assert reponse.json()["detail"] == "Email ou mot de passe incorrect"


def test_connexion_email_inconnu_refuse(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """Email inconnu en base -> meme 401 (pas de difference d'existence)."""

    async def _obtenir_par_email(email: str):
        return None

    monkeypatch.setattr(persistance, "obtenir_utilisateur_par_email", _obtenir_par_email)

    reponse = client.post(
        "/auth/connexion",
        json={"email": "inconnu@aeris.local", "mot_de_passe": "SuperMotDePasse2026"},
    )
    assert reponse.status_code == 401


def test_connexion_compte_desactive_refuse(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    """Un compte desactive ne peut plus se connecter (403)."""

    async def _obtenir_par_email(email: str):
        utilisateur = _utilisateur(email=email)
        utilisateur.actif = False
        return utilisateur

    monkeypatch.setattr(persistance, "obtenir_utilisateur_par_email", _obtenir_par_email)

    reponse = client.post(
        "/auth/connexion",
        json={"email": "admin@aeris.local", "mot_de_passe": "SuperMotDePasse2026"},
    )
    assert reponse.status_code == 403


def test_auth_moi_sans_token_refuse(client: TestClient):
    """GET /auth/moi exige un Bearer token."""
    reponse = client.get("/auth/moi")
    assert reponse.status_code == 401


def test_auth_moi_avec_token_retourne_personne(client: TestClient, admin_token: str):
    """GET /auth/moi avec un token admin -> profil complet."""
    reponse = client.get("/auth/moi", headers={"Authorization": f"Bearer {admin_token}"})
    assert reponse.status_code == 200
    donnees = reponse.json()
    assert donnees["role"] == "admin"
    assert donnees["actif"] is True


def test_refresh_token_echange_vs_access(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    """Un refresh token renouvelle l'access token ; un access token ne le peut pas."""
    from app.authentification import creer_jwt

    utilisateur = _utilisateur()

    async def _obtenir_par_id(id_: int):
        return utilisateur

    monkeypatch.setattr(persistance, "obtenir_utilisateur_par_id", _obtenir_par_id)

    refresh = creer_jwt(
        {"sub": "1", "role": "admin", "type": "rafraichissement"},
        ttl_minutes=7 * 24 * 60,
    )
    reponse = client.post("/auth/rafraichir", json={"rafraichissement_token": refresh})
    assert reponse.status_code == 200
    assert reponse.json()["acces_token"]

    # Un access token ne joue pas le role de refresh token.
    acces = creer_jwt({"sub": "1", "role": "admin", "type": "acces"})
    reponse2 = client.post("/auth/rafraichir", json={"rafraichissement_token": acces})
    assert reponse2.status_code == 401
    assert "refresh" in reponse2.json()["detail"]


def test_rafraichissement_token_refuse_comme_bearer(client: TestClient):
    """Un refresh token (7 jours) ne doit pas ouvrir une route protegee.

    Sans ce controle, un token longue duree volé servait de Bearer partout,
    rendant inutile la duree courte (30 min) de l'access token.
    """
    from app.authentification import creer_jwt

    refresh = creer_jwt(
        {"sub": "1", "role": "admin", "type": "rafraichissement"},
        ttl_minutes=7 * 24 * 60,
    )
    reponse = client.get(
        "/auth/moi", headers={"Authorization": f"Bearer {refresh}"}
    )
    assert reponse.status_code == 401
    assert "Type de token invalide" in reponse.json()["detail"]


def test_token_sans_type_reste_accepte(client: TestClient):
    """Compatibilite ascendante : un JWT anterieur sans claim ``type`` passe."""
    from app.authentification import creer_jwt

    ancien = creer_jwt({"sub": "1", "role": "admin"})
    reponse = client.get("/auth/moi", headers={"Authorization": f"Bearer {ancien}"})
    assert reponse.status_code == 200
    assert reponse.json()["role"] == "admin"