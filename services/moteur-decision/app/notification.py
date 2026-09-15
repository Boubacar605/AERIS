"""Envoi de notifications email aux patients (resultats + OTP).

En dev/test (SMTP_HOTE vide), le contenu de l'email est simplement logge
dans la console Docker pour faciliter le debug sans service SMTP externe.

Supporte deux modes d'envoi :
  - SMTP classique (aiosmtplib) : mode par defaut, SMTP_HOTE/PORT/UTILISATEUR
  - API Brevo : active automatiquement si la cle commence par 'xkeysib-'
    (cle API) — utilise httpx + endpoint transactional Brevo.
"""

import logging
from email.message import EmailMessage

import aiosmtplib
import httpx

from app.config import config

_logger = logging.getLogger("aeris.notification")

_BREVO_API_URL = "https://api.brevo.com/v3/smtp/email"


def _est_cle_brevo_api(cle: str | None) -> bool:
    """Renvoie True si la cle est une cle API Brevo (xkeysib-…)."""
    return bool(cle and cle.startswith("xkeysib-"))


async def _envoyer_via_brevo_api(
    email_destination: str,
    corps: str,
    code_otp: str,
) -> bool:
    """Envoie un email via l'API transactionnelle Brevo (httpx async)."""
    payload = {
        "sender": {
            "name": "AERIS EDGE-CLOUD AI",
            "email": config.smtp_utilisateur or config.smtp_expediteur,
        },
        "to": [{"email": email_destination}],
        "subject": "AERIS — Vos resultats radiologiques",
        "textContent": corps,
    }
    headers = {
        "api-key": config.smtp_mot_de_passe,
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient() as client:
        resp = await client.post(_BREVO_API_URL, json=payload, headers=headers, timeout=30)
        resp.raise_for_status()
    _logger.info("Email envoye via API Brevo a %s", email_destination)
    return True


async def envoyer_notification_resultat(
    email_destination: str,
    code_otp: str,
    nom_patient: str | None = None,
) -> bool:
    """Envoie un email au patient avec le lien OTP pour consulter ses resultats.

    Retourne True si l'envoi (ou la simulation) a reussi.
    """
    nom = nom_patient or "Patient"
    lien = f"{config.url_tableau_de_bord}/resultat?otp={code_otp}"

    corps = (
        f"Bonjour {nom},\n\n"
        f"Votre examen radiologique a ete traite par le systeme AERIS.\n\n"
        f"Pour consulter vos resultats, utilisez le lien ci-dessous :\n"
        f"{lien}\n\n"
        f"Code OTP : {code_otp}\n"
        f"Ce code est valide pendant {config.otp_ttl_minutes} minutes.\n\n"
        f"---\n"
        f"AERIS — Radiologie Adaptative Edge-Cloud\n"
        f"Universite Alioune Diop de Bambey (UADB)\n"
    )

    # Fallback : si aucun SMTP n'est configure, on log le contenu
    if not config.smtp_hote and not config.smtp_mot_de_passe:
        _logger.info(
            "_EMAIL_SIMULEE → %s | Lien: %s | OTP: %s",
            email_destination,
            lien,
            code_otp,
        )
        return True

    try:
        # Cle API Brevo (xkeysib-…) → envoi via l'API transactionnelle
        if _est_cle_brevo_api(config.smtp_mot_de_passe):
            return await _envoyer_via_brevo_api(email_destination, corps, code_otp)

        # Sinon → SMTP classique (aiosmtplib)
        message = EmailMessage()
        message["From"] = config.smtp_expediteur
        message["To"] = email_destination
        message["Subject"] = "AERIS — Vos resultats radiologiques"
        message.set_content(corps)

        await aiosmtplib.send(
            message,
            hostname=config.smtp_hote,
            port=config.smtp_port,
            username=config.smtp_utilisateur or None,
            password=config.smtp_mot_de_passe or None,
            start_tls=bool(config.smtp_utilisateur),
        )
        _logger.info("Email envoye via SMTP a %s", email_destination)
        return True
    except Exception as exc:  # noqa: BLE001
        _logger.error("Echec envoi email a %s : %s", email_destination, exc)
        return False
