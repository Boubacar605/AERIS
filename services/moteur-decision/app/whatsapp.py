"""Envoi de notifications WhatsApp (OTP) via le relais AERIS (Baileys).

Le backend contacte le micro-service ``relay-whatsapp`` (Node.js + Baileys,
session WhatsApp Web multi-device) sur ``POST /envoyer`` avec le numéro
normalisé (E.164 sans ``+``) et un message texte libre en français, branding
AERIS — pas de template ni d'approbation Meta comme avec une passerelle API
Business.

Quand aucun relais n'est configuré (dev/tests), le contenu est simplement
loggé dans la console — même principe que le fallback email.
"""

import logging
import re

import httpx

from app.config import config

_logger = logging.getLogger("aeris.whatsapp")


def normaliser_numero(telephone: str) -> str:
    """Normalise un numero vers le format international WhatsApp (sans +).

    - retire espaces, points, tirets et slashes ;
    - prefixe par le prefixe pays si le numero ne commence pas deja par
      le prefixe ou par ``+``.
    """
    chiffres = re.sub(r"[^\d]", "", telephone or "")
    if not chiffres:
        return ""

    prefixe = config.whatsapp_prefixe_pays or ""
    if prefixe and not chiffres.startswith(prefixe):
        chiffres = f"{prefixe}{chiffres}"
    return chiffres


def composer_message_otp(
    code_otp: str,
    nom_patient: str | None = None,
    url: str | None = None,
) -> str:
    """Construit le message WhatsApp du code OTP (texte libre, français).

    Le patient reçoit un message lisible, identifiable AERIS, avec le code et
    le lien de consultation. La validité vient de la configuration OTP.
    """
    nom = nom_patient or "Patient"
    url = url or config.url_tableau_de_bord

    return (
        f"AERIS — Résultats radiologiques\n\n"
        f"Bonjour {nom},\n\n"
        f"Votre examen radiologique vient d'être analysé.\n\n"
        f"Code de consultation : {code_otp}\n\n"
        f"Ce code est valable {config.otp_ttl_minutes} minutes.\n"
        f"Rendez-vous sur {url}/resultat et saisissez votre numéro puis ce code.\n\n"
        f"──\n"
        f"AERIS — Radiologie Adaptative Edge-Cloud (UADB)"
    )


async def envoyer_otp_whatsapp(
    telephone: str,
    code_otp: str,
    nom_patient: str | None = None,
) -> bool:
    """Envoie un message WhatsApp au patient avec son code OTP.

    Retourne True si l'envoi (ou la simulation) a reussi.
    """
    numero = normaliser_numero(telephone)
    if not numero:
        _logger.warning("WhatsApp : telephone invalide (%s), envoi ignore", telephone)
        return False

    if not config.whatsapp_url_relay:
        _logger.info(
            "_WHATSAPP_SIMULE → %s | OTP: %s",
            numero,
            code_otp,
        )
        return True

    message = composer_message_otp(code_otp, nom_patient=nom_patient)

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            reponse = await client.post(
                f"{config.whatsapp_url_relay.rstrip('/')}/envoyer",
                json={"to": numero, "message": message},
            )
        if reponse.is_success and reponse.json().get("ok"):
            _logger.info("WhatsApp envoye a %s (%s)", numero, reponse.status_code)
            return True
        _logger.error(
            "Echec relay WhatsApp vers %s : %s — %s",
            numero,
            reponse.status_code,
            reponse.text[:300],
        )
        return False
    except Exception as exc:  # noqa: BLE001 - toute cause rend l'envoi impossible
        _logger.error("Echec relay WhatsApp vers %s : %s", numero, exc)
        return False