"""Envoi de notifications email aux patients (resultats + OTP).

En dev/test (SMTP_HOTE vide), le contenu de l'email est simplement logge
dans la console Docker pour faciliter le debug sans service SMTP externe.

Utilise SMTP classique (aiosmtplib) pour l'envoi via Gmail ou tout autre
serveur SMTP.  L'avatar de l'expediteur s'affiche dans Gmail car le domaine
n'est pas reecrit.
"""

import logging
from email.message import EmailMessage

import aiosmtplib

from app.config import config
from app.whatsapp import envoyer_otp_whatsapp

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
        f"Ce code n'expire pas : vous pouvez consulter vos resultats\n"
        f"autant de fois que vous le souhaitez.\n\n"
        f"---\n"
        f"AERIS — Radiologie Adaptative Edge-Cloud\n"
        f"Universite Alioune Diop de Bambey (UADB)\n"
    )

    # Fallback : si aucun SMTP n'est configure, on log le contenu
    if not config.smtp_hote or not config.smtp_mot_de_passe:
        _logger.info(
            "_EMAIL_SIMULEE → %s | Lien: %s | OTP: %s",
            email_destination,
            lien,
            code_otp,
        )
        return True

    try:
        message = EmailMessage()
        message["From"] = f"AERIS EDGE-CLOUD AI <{config.smtp_expediteur}>"
        message["To"] = email_destination
        message["Subject"] = "AERIS — Vos resultats radiologiques"
        message.set_content(corps)

        await aiosmtplib.send(
            message,
            hostname=config.smtp_hote,
            port=config.smtp_port,
            username=config.smtp_utilisateur or None,
            password=config.smtp_mot_de_passe or None,
            start_tls=config.smtp_start_tls,
        )
        _logger.info("Email envoye via SMTP a %s", email_destination)
        return True
    except Exception as exc:  # noqa: BLE001
        _logger.error("Echec envoi email a %s : %s", email_destination, exc)
        return False


async def envoyer_notification_otp(
    patient,
    code_otp: str,
) -> dict:
    """Adresse l'OTP au patient sur le(s) canal(x) de notification.

    Choix du canal (flux « Approuver » de la page Résultat) :
    1. telephone + email  : envoi **Email ET WhatsApp** (``email+whatsapp``) ;
    2. telephone seul     : **WhatsApp** (le relais AERIS Baileys, canal
       cible pour les patients sans email) ;
    3. email seul         : **Email** (anciens comptes sans telephone).

    Un canal indisponible ne doit pas faire perdre l'OTP : le résultat est
    un succes des que **au moins un** canal a recu le code. Chaque canal est
    trace separement pour que l'interface puisse signaler precisely le
    compteur, et non un echec global trompeur.

    Retourne ``{"canal": "email+whatsapp"|"whatsapp"|"email"|"aucun",
    "ok": bool, "canaux": {"email": bool, "whatsapp": bool},
    "canaux_oks": [...], "avertissements": [...]}``.
    """
    telephone = getattr(patient, "telephone", None)
    email = getattr(patient, "email", None)
    nom = getattr(patient, "nom_complet", None)

    canaux: dict[str, bool] = {}
    if telephone:
        canaux["whatsapp"] = await envoyer_otp_whatsapp(
            telephone,
            code_otp,
            nom_patient=nom,
        )
        if email:
            canaux["email"] = await envoyer_notification_resultat(
                email_destination=email,
                code_otp=code_otp,
                nom_patient=nom,
            )
            return _statut_otp("email+whatsapp", canaux)
        return _statut_otp("whatsapp", canaux)

    if email:
        canaux["email"] = await envoyer_notification_resultat(
            email_destination=email,
            code_otp=code_otp,
            nom_patient=nom,
        )
        return _statut_otp("email", canaux)

    _logger.warning("Patient %s sans telephone ni email — OTP non envoye", patient.code_patient)
    return _statut_otp("aucun", canaux)


def _statut_otp(canal: str, canaux: dict[str, bool]) -> dict:
    """Construit le verdict d'envoi a partir du succes par canal.

    ``ok`` est vrai des qu'un canal a abouti : l'OTP reste accessible au
    patient, et un compteur en panne (relais WhatsApp hors ligne) ne doit
    pas etre presente comme un envoi completement rate.
    """
    # L'ordre de diffusion est stable pour l'affichage et les tests.
    ordre = ("email", "whatsapp")
    tries = {nom: bool(ok) for nom, ok in canaux.items()}
    succes = [nom for nom in ordre if tries.get(nom)]
    echecs = [nom for nom in ordre if nom in tries and not tries[nom]]

    avertissements = []
    if succes and echecs:
        avertissements.append(
            f"OTP delivre par {', '.join(succes)} mais l'envoi par "
            f"{', '.join(echecs)} a echoue (canal indisponible)."
        )
    elif echecs and not succes:
        avertissements.append(
            f"Aucun canal n'a abouti ({', '.join(echecs)} indisponible(s)). "
            "Communiquez l'OTP au patient par un autre moyen."
        )

    return {
        "canal": canal,
        "ok": bool(succes),
        "canaux": tries,
        "canaux_oks": succes,
        "avertissements": avertissements,
    }
