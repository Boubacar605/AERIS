"""Tests du flux patient automatique : en-tête, code auto, approbation OTP.

Le flux (exigences utilisateur) :
- le clinicien remplit un en-tête (nom, prénom, date de naissance, email
  optionnel, téléphone obligatoire) AVANT l'upload ;
- le code patient AER-AAAA-NNNN est généré automatiquement (plus de saisie) ;
- avant d'enregistrer, on vérifie que le téléphone n'existe pas déjà (sinon
  le compte existant est réutilisé) ;
- la notification OTP (email + WhatsApp, ou WhatsApp seul) part uniquement
  sur le bouton « Approuver » de la page Résultat.
"""

from __future__ import annotations

import asyncio
import datetime
import types

import pytest
from fastapi.testclient import TestClient

from app import persistance


def _patient(code: str = "AER-2026-0042", telephone: str | None = "221771234567") -> types.SimpleNamespace:
    return types.SimpleNamespace(
        id_patient=42,
        code_patient=code,
        nom_complet="Awa Diop",
        email="awa.diop@example.org",
        telephone=telephone,
    )


# ---------------------------------------------------------------------------
# Code patient automatique (format AER-AAAA-NNNN)
# ---------------------------------------------------------------------------

class _SessionFake:
    def __init__(self, codes: list[str]):
        self.codes = codes

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def execute(self, statement, params=None):
        # Simule le filtre LIKE de generer_code_patient : seuls les codes du
        # préfixe de l'année courante ("AER-2026-%") comptent dans la suite.
        prefixe = (params or {}).get("prefix", "").rstrip("%")

        class _Resultat:
            def __init__(self, codes):
                self._codes = codes

            def all(self):
                return [(code,) for code in self._codes]

        return _Resultat(c for c in self.codes if c.startswith(prefixe))


class _SessionMakerFake:
    """Se substitue au ``async_sessionmaker`` (callable -> session factice)."""

    def __init__(self, codes: list[str]):
        self.codes = codes

    def __call__(self):
        return _SessionFake(self.codes)


@pytest.mark.parametrize(
    ("codes", "attendu"),
    [
        ([], "AER-2026-0001"),
        (["AER-2026-0001"], "AER-2026-0002"),
        (["AER-2026-0001", "AER-2026-0003"], "AER-2026-0004"),
        (["AER-2025-0099"], "AER-2026-0001"),  # autre année : la séquence repart
    ],
)
def test_generer_code_patient_sequence_par_annee(monkeypatch, codes, attendu):
    """Le code auto reprend le suffixe max de l'année courante, +1."""
    annee = datetime.datetime.now(datetime.timezone.utc).year
    attendu = attendu.replace("2026", str(annee))
    codes = [c.replace("2026", str(annee)).replace("2025", str(annee - 1)) for c in codes]
    monkeypatch.setattr(persistance, "_sessions", _SessionMakerFake(codes))
    assert asyncio.run(persistance.generer_code_patient()) == attendu


# ---------------------------------------------------------------------------
# POST /routage/patient — création de l'en-tête avant l'analyse
# ---------------------------------------------------------------------------

def test_en_tete_patient_cree_un_code_automatique(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """Téléphone inconnu -> patient créé, code généré par le système."""
    captures: dict = {}

    async def _rechercher(numero: str):
        return None

    async def _creer(**kwargs):
        captures.update(kwargs)
        return _patient()

    monkeypatch.setattr(persistance, "rechercher_patient_par_telephone", _rechercher)
    monkeypatch.setattr(persistance, "creer_patient", _creer)

    reponse = client.post(
        "/routage/patient",
        headers={"Authorization": f"Bearer {clinicien_token}"},
        json={
            "nom": "Diop",
            "prenom": "Awa",
            "date_naissance": "2000-04-12",
            "telephone": "77 123 45 67",
        },
    )
    assert reponse.status_code == 200
    donnees = reponse.json()
    assert donnees["deja_enregistre"] is False
    assert donnees["code_patient"] == "AER-2026-0042"
    # Le téléphone arrive normalisé (forme stockée / index de dédoublonnage).
    assert captures["telephone"] == "77 123 45 67"
    assert captures["nom"] == "Diop"
    assert captures["prenom"] == "Awa"
    assert captures["date_naissance"] == datetime.date(2000, 4, 12)


def test_en_tete_patient_reutilise_le_compte_existant(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """Téléphone déjà enregistré -> aucun doublon, compte réutilisé."""
    existant = _patient(code="AER-2026-0007")

    async def _rechercher(numero: str):
        return existant

    async def _creer(**kwargs):
        raise AssertionError("ne doit pas créer un doublon")

    monkeypatch.setattr(persistance, "rechercher_patient_par_telephone", _rechercher)
    monkeypatch.setattr(persistance, "creer_patient", _creer)

    reponse = client.post(
        "/routage/patient",
        headers={"Authorization": f"Bearer {clinicien_token}"},
        json={"nom": "Diop", "prenom": "Awa", "telephone": "77 123 45 67"},
    )
    assert reponse.status_code == 200
    donnees = reponse.json()
    assert donnees["deja_enregistre"] is True
    assert donnees["code_patient"] == "AER-2026-0007"
    assert donnees["id_patient"] == 42


def test_en_tete_patient_exige_nom_et_telephone_valides(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """Nom vide ou téléphone sans chiffres -> 422, jamais de création muette."""
    appels = []

    async def _rechercher(numero: str):
        appels.append(numero)
        return None

    async def _creer(**kwargs):
        appels.append(kwargs)

    monkeypatch.setattr(persistance, "rechercher_patient_par_telephone", _rechercher)
    monkeypatch.setattr(persistance, "creer_patient", _creer)

    for corps in (
        {"nom": "", "prenom": "Awa", "telephone": "771234567"},
        {"nom": " Diop ", "prenom": "aw a", "telephone": "abc"},
    ):
        reponse = client.post(
            "/routage/patient",
            headers={"Authorization": f"Bearer {clinicien_token}"},
            json=corps,
        )
        assert reponse.status_code == 422, corps
    assert appels == []


# ---------------------------------------------------------------------------
# POST /admin/examens/approuver — déclenchement de la notification OTP
# ---------------------------------------------------------------------------

def test_approuver_examen_envoie_email_et_whatsapp(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """Patient avec email -> canal email+whatsapp (exigence utilisateur)."""
    patient = _patient()
    appels: dict = {}

    async def _obtenir(code: str):
        appels["recherche"] = code
        return patient

    async def _stocker(id_patient, id_examen, destination):
        appels["destination"] = destination
        return "123456"

    async def _notifier(sujet, code_otp):
        appels["code_otp"] = code_otp
        return {"canal": "email+whatsapp", "ok": True}

    monkeypatch.setattr(persistance, "obtenir_patient_par_code", _obtenir)
    monkeypatch.setattr(persistance, "generer_et_stocker_otp", _stocker)
    monkeypatch.setattr("app.routes.admin.envoyer_notification_otp", _notifier)

    reponse = client.post(
        "/admin/examens/approuver",
        headers={"Authorization": f"Bearer {clinicien_token}"},
        json={"code_patient": "AER-2026-0042"},
    )
    assert reponse.status_code == 200
    donnees = reponse.json()
    assert donnees["statut"] == "otp_envoye"
    assert donnees["canal"] == "email+whatsapp"
    assert donnees["contact"] == "221771234567"
    assert appels["destination"] == "221771234567"
    assert appels["code_otp"] == "123456"


def test_approuver_examen_whatsapp_seul_sans_email(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """Patient sans email -> WhatsApp seul, contact = numéro normalisé."""
    patient = _patient(telephone="221771234567")
    patient.email = None

    async def _obtenir(code: str):
        return patient

    async def _stocker(id_patient, id_examen, destination):
        return "654321"

    async def _notifier(sujet, code_otp):
        return {"canal": "whatsapp", "ok": True}

    monkeypatch.setattr(persistance, "obtenir_patient_par_code", _obtenir)
    monkeypatch.setattr(persistance, "generer_et_stocker_otp", _stocker)
    monkeypatch.setattr("app.routes.admin.envoyer_notification_otp", _notifier)

    reponse = client.post(
        "/admin/examens/approuver",
        headers={"Authorization": f"Bearer {clinicien_token}"},
        json={"code_patient": "AER-2026-0042"},
    )
    assert reponse.status_code == 200
    assert reponse.json()["canal"] == "whatsapp"
    assert reponse.json()["contact"] == "221771234567"


def test_approuver_examen_unknown_patient_404(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """Code inconnu -> 404, aucune notification envoyée."""

    async def _obtenir(code: str):
        return None

    async def _stocker(id_patient, id_examen, destination):
        return "000000"

    async def _notifier(sujet, code_otp):
        raise AssertionError("ne doit pas notifier un patient introuvable")

    monkeypatch.setattr(persistance, "obtenir_patient_par_code", _obtenir)
    monkeypatch.setattr(persistance, "generer_et_stocker_otp", _stocker)
    monkeypatch.setattr("app.routes.admin.envoyer_notification_otp", _notifier)

    reponse = client.post(
        "/admin/examens/approuver",
        headers={"Authorization": f"Bearer {clinicien_token}"},
        json={"code_patient": "AER-2026-9999"},
    )
    assert reponse.status_code == 404