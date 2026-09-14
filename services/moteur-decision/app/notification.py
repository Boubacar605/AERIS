"""Envoi de notifications email aux patients (resultats + OTP).

En dev/test (SMTP_HOTE vide), le contenu de l'email est simplement logge
dans la console Docker pour faciliter le debug sans service SMTP externe.
"""

import logging
from email.message import EmailMessage

import aiosmtplib

from app.config import config

_logger = logging.getLogger("aeris.notification")


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
    if not config.smtp_hote:
        _logger.info(
            "_EMAIL_SIMULEE → %s | Lien: %s | OTP: %s",
            email_destination,
            lien,
            code_otp,
        )
        return True

    try:
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
        _logger.info("Email envoye a %s", email_destination)
        return True
    except Exception as exc:  # noqa: BLE001
        _logger.error("Echec envoi email a %s : %s", email_destination, exc)
        return False
