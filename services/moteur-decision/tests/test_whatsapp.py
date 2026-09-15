"""Tests du canal WhatsApp via le relais AERIS (Baileys).

Sans relais configuré (``WHATSAPP_URL_RELAY`` vide — défaut hors Docker),
l'envoi est loggé (fallback ``_WHATSAPP_SIMULE``). Avec un relais simulé
(mock httpx), on vérifie le payload envoyé : numéro normalisé + message.
"""

from __future__ import annotations

import asyncio

import pytest

from app import whatsapp
from app.config import config
from app.notification import envoyer_notification_otp
from app.whatsapp import composer_message_otp, envoyer_otp_whatsapp, normaliser_numero


def _patient(telephone=None, email=None, nom="Patient test", code="AERIS-2026-0001"):
    return type(
        "Patient",
        (),
        {
            "telephone": telephone,
            "email": email,
            "nom_complet": nom,
            "code_patient": code,
        },
    )()


class ReponseRelaisFake:
    is_success = True
    status_code = 200
    text = '{"ok": true}'

    def json(self):
        return {"ok": True}

    @classmethod
    def echec(cls):
        reponse = cls()
        reponse.text = '{"ok": false, "erreur": "boom"}'
        return reponse


def _capturer_posts(monkeypatch) -> list[tuple[str, dict]]:
    """Relais actif + capture des POST httpx (client fake)."""
    appels: list[tuple[str, dict]] = []
    monkeypatch.setattr(config, "whatsapp_url_relay", "http://relais-test:3500")

    class ClientFake:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, json=None, **kwargs):
            appels.append((url, json))
            return ReponseRelaisFake()

    monkeypatch.setattr(whatsapp.httpx, "AsyncClient", ClientFake)
    return appels


# ---------------------------------------------------------------------------
# Normalisation des numéros
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    ("entree", "attendu"),
    [
        ("77 123 45 67", "221771234567"),   # espace + préfixe pays
        ("+221 78 123 45 67", "221781234567"),  # déjà international → inchangé
        ("221771234567", "221771234567"),    # déjà prefixé → inchangé
        ("(77) 123-45-67", "221771234567"),  # caractères non chiffrés retirés
        ("", ""),                            # vide
        (None, ""),                          # absent
    ],
)
def test_normalisation_numero(entree, attendu):
    """Les numéros sont normalisés au format international WhatsApp."""
    assert normaliser_numero(entree) == attendu


# ---------------------------------------------------------------------------
# Texte du message OTP
# ---------------------------------------------------------------------------

def test_message_otp_contient_code_nom_url_et_validite():
    """Le message est en français, marqué AERIS, avec tout ce qu'il faut."""
    message = composer_message_otp(
        "123456",
        nom_patient="Awa Diop",
        url="https://aeris.demo.sn",
    )
    assert "123456" in message
    assert "Awa Diop" in message
    assert "https://aeris.demo.sn/resultat" in message
    assert str(config.otp_ttl_minutes) in message
    assert "AERIS" in message


def test_message_otp_sans_nom_utilise_patient():
    """Sans nom connu, le message reste générique mais complet."""
    message = composer_message_otp("654321", url="http://localhost:3000")
    assert "654321" in message
    assert "Patient" in message
    assert "http://localhost:3000/resultat" in message


# ---------------------------------------------------------------------------
# Envoi via le relais
# ---------------------------------------------------------------------------

def test_envoi_via_relais_normalise_le_numero_et_transmet_le_message(monkeypatch):
    """Le relais reçoit le numéro normalisé et un message complet."""
    appels = _capturer_posts(monkeypatch)

    ok = asyncio.run(envoyer_otp_whatsapp("77 123 45 67", "123456", "Awa Diop"))
    assert ok is True

    (url, corps), = appels
    assert url == "http://relais-test:3500/envoyer"
    assert corps["to"] == "221771234567"
    assert "123456" in corps["message"]
    assert "Awa Diop" in corps["message"]


def test_envoi_via_relais_echoue_retourne_false(monkeypatch):
    """Un refus du relais (ok:false) se traduit par un échec côté moteur."""
    monkeypatch.setattr(config, "whatsapp_url_relay", "http://relais-test:3500")

    class ClientEchec:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, json=None, **kwargs):
            return ReponseRelaisFake.echec()

    monkeypatch.setattr(whatsapp.httpx, "AsyncClient", ClientEchec)

    assert asyncio.run(envoyer_otp_whatsapp("77 123 45 67", "123456")) is False


def test_envoi_sans_relais_configure_est_simule(monkeypatch):
    """Sans relais, l'envoi est loggé et retourne True."""
    monkeypatch.setattr(config, "whatsapp_url_relay", "")
    assert not config.whatsapp_url_relay

    logs: list[str] = []
    monkeypatch.setattr(
        whatsapp._logger, "info", lambda *args: logs.append(" ".join(str(a) for a in args))
    )

    assert asyncio.run(envoyer_otp_whatsapp("77 123 45 67", "123456")) is True

    assert any("WHATSAPP_SIMULE" in ligne for ligne in logs)
    assert any("221771234567" in ligne for ligne in logs)


# ---------------------------------------------------------------------------
# Choix du canal (notifications)
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _relais_simule(monkeypatch):
    """Tous les tests de canal restent hors réseau (relais vide)."""
    monkeypatch.setattr(config, "whatsapp_url_relay", "")


def _envoyer(patient):
    return asyncio.run(envoyer_notification_otp(patient, code_otp="123456"))


def test_choix_du_canal_email_plus_whatsapp_avec_telephone_et_email():
    """Un patient avec téléphone ET email reçoit son OTP sur les deux canaux."""
    patient = _patient(telephone="77 123 45 67", email="patient@example.org")
    resultat = _envoyer(patient)
    assert resultat["canal"] == "email+whatsapp"
    assert resultat["ok"] is True


def test_choix_du_canal_whatsapp_avec_telephone_seul():
    """Échec parent : sans email, seul le WhatsApp est notifié."""
    patient = _patient(telephone="77 123 45 67", email=None)
    resultat = _envoyer(patient)
    assert resultat["canal"] == "whatsapp"
    assert resultat["ok"] is True


def test_choix_du_canal_email_sans_telephone():
    """Un patient sans téléphone (mais avec email) retombe sur l'email."""
    patient = _patient(telephone=None, email="patient@example.org")

    assert not config.smtp_hote  # SMTP vide → email simulé dans les logs
    resultat = _envoyer(patient)
    assert resultat["canal"] == "email"
    assert resultat["ok"] is True


def test_choix_du_canal_aucun_sans_contact():
    """Patient sans téléphone ni email : aucun canal, ok=False."""
    patient = _patient(telephone=None, email=None)
    resultat = _envoyer(patient)
    assert resultat["canal"] == "aucun"
    assert resultat["ok"] is False