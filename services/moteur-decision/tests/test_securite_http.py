"""Tests de la securite HTTP : limiteur de debit et protection de /metrics.

Le limiteur ne borne que les surfaces de devinette de secret (connexion,
acces OTP) : ces tests verifient le 429 au bon format, l'isolement par adresse
et la non-limitation de /routage/analyser.
"""

from __future__ import annotations

import pytest
from app import limiteur_debit
from app.config import config
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _limiteur_neuf() -> None:
    """Chaque test part d'un historique vide (etat module partage sinon)."""
    limiteur_debit.reinitialiser()


def test_connexion_limitee_apres_plafond(client: TestClient) -> None:
    """Au-dela du plafond par minute, la connexion repond 429 au format detail."""
    plafond = config.limite_connexion_par_minute
    corps = {"email": "admin@aeris.local", "mot_de_passe": "Mauvais"}

    statuts = [client.post("/auth/connexion", json=corps).status_code for _ in range(plafond + 3)]

    # Les premiers appels ne sont pas limites (401 attendu), le dernier l'est.
    assert statuts[-1] == 429
    assert 401 in statuts[:plafond]

    reponse = client.post("/auth/connexion", json=corps)
    assert reponse.status_code == 429
    assert "detail" in reponse.json()
    assert "Trop de requetes" in reponse.json()["detail"]


def test_acces_resultat_limite_par_adresse(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Un plafond atteint par une adresse n'affecte pas une autre adresse."""
    from app import persistance

    monkeypatch.setattr(persistance, "active", lambda: True)

    async def _otp_invalide(code: str, destination: str):
        return None

    monkeypatch.setattr(persistance, "verifier_otp", _otp_invalide)

    plafond = config.limite_acces_resultat_par_minute
    corps = {"code_otp": "000000", "email": "patient@aeris.local"}

    for _ in range(plafond):
        client.post("/acces-resultat", json=corps, headers={"X-Forwarded-For": "10.0.0.1"})

    # La meme adresse est desormais bloquee...
    bloque = client.post("/acces-resultat", json=corps, headers={"X-Forwarded-For": "10.0.0.1"})
    assert bloque.status_code == 429

    # ...mais une autre adresse garde son quota.
    autre = client.post("/acces-resultat", json=corps, headers={"X-Forwarded-For": "10.0.0.2"})
    assert autre.status_code != 429


def test_routage_analyser_non_limite(client: TestClient) -> None:
    """/routage/analyser n'est jamais bornee : les scenarios la saturent a dessein.

    Sans JWT, elle repond 401 (authentification d'abord) ; l'essentiel est
    qu'aucun appel ne renvoie 429, meme repete au-dela des plafonds.
    """
    statuts = set()
    for _ in range(config.limite_connexion_par_minute + 5):
        reponse = client.post("/routage/analyser")
        statuts.add(reponse.status_code)

    assert 429 not in statuts


def test_metrics_refuse_depuis_un_navigateur(client: TestClient) -> None:
    """Avec Origin (navigateur) et METRICS_PUBLIC=False, /metrics repond 403."""
    config.metrics_public = False
    try:
        reponse = client.get("/metrics", headers={"Origin": "http://localhost:8080"})
        assert reponse.status_code == 403
    finally:
        config.metrics_public = False


def test_metrics_accessible_a_prometheus(client: TestClient) -> None:
    """Sans Origin (scraping Prometheus), /metrics reste joignable en 200."""
    config.metrics_public = False
    try:
        reponse = client.get("/metrics")
        assert reponse.status_code == 200
    finally:
        config.metrics_public = False


@pytest.mark.parametrize("entete_origine", ["http://localhost:8080"])
def test_cors_origine_autorisee(client: TestClient, entete_origine: str) -> None:
    """Une origine listee recoit l'en-tete CORS, pas le joker."""
    reponse = client.get("/sante", headers={"Origin": entete_origine})
    assert reponse.status_code == 200
    assert reponse.headers.get("access-control-allow-origin") == entete_origine


def test_cors_origine_inconnue_refusee(client: TestClient) -> None:
    """Une origine non listee ne recoit aucun en-tete d'autorisation CORS."""
    reponse = client.get("/sante", headers={"Origin": "http://evil.example"})
    assert reponse.status_code == 200
    assert "access-control-allow-origin" not in reponse.headers
