"""Tests du flux OTP patient : generation, hachage et endpoint d'acces."""

from __future__ import annotations

import types

import pytest
from fastapi.testclient import TestClient

from app import persistance
from app.otp import generer_otp, hacher_otp


def _patient(code: str = "AERIS-2026-0001") -> types.SimpleNamespace:
    return types.SimpleNamespace(
        id_patient=1,
        code_patient=code,
        nom_complet="Patient de test",
        email="patient@example.org",
    )


# ---------------------------------------------------------------------------
# Helpers purs
# ---------------------------------------------------------------------------

def test_generer_otp_est_numerique_et_de_bonne_longueur():
    """Un OTP est compose de chiffres uniquement, de la longueur demandee."""
    for longueur in (4, 6, 8):
        code = generer_otp(longueur)
        assert len(code) == longueur
        assert code.isdigit()


def test_hacher_otp_est_un_sha256_hex():
    """Le hash d'un code est stable et ne contient pas le code en clair."""
    code = "847293"
    hash_1 = hacher_otp(code)
    hash_2 = hacher_otp(code)
    assert hash_1 == hash_2
    assert len(hash_1) == 64  # hex sha256
    assert code not in hash_1


# ---------------------------------------------------------------------------
# Endpoint public /acces-resultat
# ---------------------------------------------------------------------------

def test_acces_resultat_avec_otp_valide_retourne_patient_et_resultats(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    """OTP correct -> patient + ses resultats (texte seul)."""

    async def _verifier(code: str, destination: str):
        return _patient()

    async def _resultats(id_patient: int):
        return [
            {
                "code_examen": "EX-2026-001",
                "execute_le": "2026-09-14T10:00:00Z",
                "resultats": [
                    {"pathologie": "tuberculose", "prediction": "negatif", "confiance": 0.92}
                ],
            }
        ]

    monkeypatch.setattr(persistance, "verifier_otp", _verifier)
    monkeypatch.setattr(persistance, "obtenir_resultats_par_patient", _resultats)

    reponse = client.post(
        "/acces-resultat", json={"code_otp": "123456", "email": "patient@example.org"}
    )
    assert reponse.status_code == 200
    donnees = reponse.json()
    assert donnees["patient"]["code_patient"] == "AERIS-2026-0001"
    assert donnees["resultats"][0]["resultats"][0]["prediction"] == "negatif"


def test_acces_resultat_otp_invalide_refuse(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    """OTP inconnu ou epuise -> 401 sans detail d'emoi."""

    async def _verifier(code: str, destination: str):
        return None

    monkeypatch.setattr(persistance, "verifier_otp", _verifier)

    reponse = client.post(
        "/acces-resultat", json={"code_otp": "000000", "email": "patient@example.org"}
    )
    assert reponse.status_code == 401


def test_acces_resultat_est_public_sans_token(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    """Un patient n'a jamais besoin de compte : le flux est public.

    Aucun en-tete Authorization n'est fourni ; seul le verdict OTP compte.
    """

    async def _verifier(code: str, destination: str):
        return None

    monkeypatch.setattr(persistance, "verifier_otp", _verifier)

    reponse = client.post(
        "/acces-resultat", json={"code_otp": "999999", "email": "x@example.org"}
    )
    assert reponse.status_code == 401


# ---------------------------------------------------------------------------
# Canal WhatsApp : destination OTP normalisée
# ---------------------------------------------------------------------------

def test_renvoyer_otp_whatsapp_stoque_la_destination_normalisee(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, admin_token: str
):
    """Un patient à téléphone reçoit son OTP avec une destination normalisée.

    La vérification (acces.py) normalise la saisie du patient ; la destination
    stockée doit donc l'être aussi, sinon un numéro saisi au format local ne
    matcherait jamais le code (régression du flux WhatsApp).
    """
    patient = types.SimpleNamespace(
        id_patient=7,
        code_patient="AERIS-2026-0007",
        nom_complet="Patient WhatsApp",
        telephone="77 123 45 67",
        email=None,
    )

    destinations: list[str] = []

    async def _obtenir(id_patient: int):
        return patient

    async def _stocker(id_patient: int, id_examen: int | None, destination: str):
        destinations.append(destination)
        return "123456"

    monkeypatch.setattr(persistance, "obtenir_patient_par_id", _obtenir)
    monkeypatch.setattr(persistance, "generer_et_stocker_otp", _stocker)

    reponse = client.post(
        "/admin/patients/7/renvoyer-otp",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert reponse.status_code == 200
    assert destinations == ["221771234567"]
    assert reponse.json()["canal"] == "whatsapp"
    # L'admin voit le numéro brut, plus lisible que sa forme normalisée.
    assert reponse.json()["contact"] == "77 123 45 67"


def test_renvoyer_otp_email_garde_la_destination_brute(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, admin_token: str
):
    """Sans téléphone, la destination reste l'email tel qu'enregistré."""
    patient = types.SimpleNamespace(
        id_patient=8,
        code_patient="AERIS-2026-0008",
        nom_complet="Patient Email",
        telephone=None,
        email="patient@example.org",
    )

    destinations: list[str] = []

    async def _obtenir(id_patient: int):
        return patient

    async def _stocker(id_patient: int, id_examen: int | None, destination: str):
        destinations.append(destination)
        return "123456"

    monkeypatch.setattr(persistance, "obtenir_patient_par_id", _obtenir)
    monkeypatch.setattr(persistance, "generer_et_stocker_otp", _stocker)

    reponse = client.post(
        "/admin/patients/8/renvoyer-otp",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert reponse.status_code == 200
    assert destinations == ["patient@example.org"]
    assert reponse.json()["canal"] == "email"
    assert reponse.json()["contact"] == "patient@example.org"