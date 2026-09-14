"""Fixtures partagees pour les tests du moteur de decision.

Aucune base PostgreSQL n'est disponible pendant les tests : la couche de
persistance est donc repliquee par ``_auth_db_factice``, qui simule la base
uniquement la où l'authentification la consulte (``active`` et
``obtenir_utilisateur_par_id``). Le chemin JWT complet (signature HS256 + role)
reste réel et est teste a fond dans ``test_authentification`` / ``test_roles``.
"""

from __future__ import annotations

import types

import pytest
from fastapi.testclient import TestClient

from app import persistance
from app.authentification import creer_jwt
from app.config import config
from app.principal import app


def _utilisateur_factice(id_utilisateur: int, role: str, actif: bool = True) -> types.SimpleNamespace:
    """Objet minimal mime l'ORM ``Utilisateur`` pour ``exiger_authentification``."""
    return types.SimpleNamespace(
        id_utilisateur=id_utilisateur,
        email=f"utilisateur-{id_utilisateur}@aeris.local",
        nom="Test",
        prenom="Test",
        role=role,
        actif=actif,
    )


def creer_token(role: str, id_utilisateur: int = 1) -> str:
    """JWT de test signe avec le vrai secret de la config."""
    return creer_jwt(
        {"sub": str(id_utilisateur), "role": role, "type": "acces"},
        ttl_minutes=config.jwt_ttl_acces_minutes,
    )


@pytest.fixture
def client() -> TestClient:
    """Client HTTP sur l'application reelle (auth court-circuitee via DB factice)."""
    return TestClient(app)


@pytest.fixture
def admin_token() -> str:
    """Token d'un administrateur (id_utilisateur=1)."""
    return creer_token("admin", id_utilisateur=1)


@pytest.fixture
def clinicien_token() -> str:
    """Token d'un clinicien (id_utilisateur=2)."""
    return creer_token("clinicien", id_utilisateur=2)


@pytest.fixture(autouse=True)
def _auth_db_factice(monkeypatch: pytest.MonkeyPatch) -> None:
    """Simule les consultations DB de l'authentification.

    Sans frapper PostgreSQL, le chemin complet du JWT est exercé : decode,
    existence de l'utilisateur, compte actif, puis contrôle de rôle.
    Les autres chemins (historie, télémétrie, …) restent en mémoire.
    """

    def _active() -> bool:
        return True

    async def _obtenir_par_id(id_utilisateur: int) -> types.SimpleNamespace | None:
        return _utilisateur_factice(
            id_utilisateur, role="admin" if id_utilisateur == 1 else "clinicien"
        )

    monkeypatch.setattr(persistance, "active", _active)
    monkeypatch.setattr(persistance, "obtenir_utilisateur_par_id", _obtenir_par_id)