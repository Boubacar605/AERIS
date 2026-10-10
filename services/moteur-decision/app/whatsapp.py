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

    - retire espaces, points, tirets, slashes et le ``+`` ;
    - retire l'indicatif national (``0`` initial des numeros locaux sénégalais)
      avant d'ajouter le prefixe pays ;
    - prefixe par le prefixe pays si le numero ne commence pas deja par lui.
    """
    chiffres = re.sub(r"[^\d]", "", telephone or "")
    if not chiffres:
        return ""

    prefixe = config.whatsapp_prefixe_pays or ""
    if prefixe and not chiffres.startswith(prefixe):
        # Numero local (0X XX XX XX XX) : on retire le 0 avant le prefixe pays.
        if chiffres.startswith("0"):
            chiffres = chiffres[1:]
        chiffres = f"{prefixe}{chiffres}"
    return chiffres


def composer_message_otp(
    code_otp: str,
    nom_patient: str | None = None,
    url: str | None = None,
) -> str:
    """Construit le message WhatsApp du code OTP (texte libre, français).

    Le patient reçoit un message lisible, identifiable AERIS, avec le code et
    le lien de consultation. Le code étant permanent, aucun délai n'est
    annoncé au patient.
    """
    nom = nom_patient or "Patient"
    url = url or config.url_tableau_de_bord

    return (
        f"AERIS — Résultats radiologiques\n\n"
        f"Bonjour {nom},\n\n"
        f"Votre examen radiologique vient d'être analysé.\n\n"
        f"Pour consulter vos résultats, ouvrez le lien ci-dessous :\n"
        f"{url}/resultat?otp={code_otp}\n\n"
        f"Code de consultation : {code_otp}\n"
        f"Ce code n'expire pas : vous pouvez revoir vos résultats\n"
        f"autant de fois que vous le souhaitez.\n\n"
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
    headers = {}
    if config.whatsapp_relay_secret:
        headers["X-Relay-Secret"] = config.whatsapp_relay_secret

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            reponse = await client.post(
                f"{config.whatsapp_url_relay.rstrip('/')}/envoyer",
                json={"to": numero, "message": message},
                headers=headers,
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


def composer_message_compte_rendu(
    nom_patient: str | None,
    resume: str,
    recommandations: list[str],
    url: str,
) -> str:
    """Compose le partage WhatsApp d'un compte rendu **valide**.

    Distinct du message d'OTP : celui-ci accompagne une approbation et porte le
    code de consultation. Celui-la ne le repete pas — le code est stocke hache
    en base, il n'est donc pas recuperable ici, et il a deja ete transmis au
    patient a l'approbation. Renvoyer un code frais a chaque partage
    multiplierait les lignes d'OTP sans securite gainee.

    Le code du patient (AER-2026-0009) n'est volontairement pas repris ici : le
    message renvoie deja au code de consultation, qui est l'OTP. Les afficher
    côte a côte ferait confondre deux codes sans rapport.

    Aucune recommandation n'est envoyee si la liste est vide, plutot que
    d'envoyer un pave vide au patient.
    """
    lignes = [
        f"Bonjour {nom_patient or ''}," if nom_patient else "Bonjour,",
        "",
        "Votre examen radiologique a ete valide par le medecin.",
        f"Resultat : {resume}",
    ]
    if recommandations:
        lignes += ["", "Suite a donner :", *(f"- {texte}" for texte in recommandations)]
    lignes += [
        "",
        f"Pour consulter le compte rendu complet : {url}/resultat",
        "Utilisez le code de consultation que vous avez recu.",
        "",
        "Ce message ne remplace pas une consultation.",
        "──",
        "AERIS - Radiologie Adaptative Edge-Cloud (UADB)",
    ]
    return "\n".join(lignes)


async def envoyer_message_whatsapp(telephone: str, message: str) -> bool:
    """Envoie un message WhatsApp arbitraire au patient.

    Meme transport que l'OTP, sans composition : l'appelant a deja decide du
    contenu. Retourne True si l'envoi, ou sa simulation, a reussi.
    """
    numero = normaliser_numero(telephone)
    if not numero:
        _logger.warning("WhatsApp : telephone invalide (%s), envoi ignore", telephone)
        return False

    if not config.whatsapp_url_relay:
        _logger.info("_WHATSAPP_SIMULE → %s | %d caracteres", numero, len(message))
        return True

    headers = {}
    if config.whatsapp_relay_secret:
        headers["X-Relay-Secret"] = config.whatsapp_relay_secret

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            reponse = await client.post(
                f"{config.whatsapp_url_relay.rstrip('/')}/envoyer",
                json={"to": numero, "message": message},
                headers=headers,
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
