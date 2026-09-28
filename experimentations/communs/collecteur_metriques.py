"""
Collecteur de metriques pour les scenarios d'experimentation.

Envoie des radiographies au moteur de decision et collecte les metriques
de performance (latence, temps d'inference, CPU/RAM, etc.).
"""

import csv
import os
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

import httpx


# URL par defaut du moteur de decision (profile Docker)
_URL_PAR_DEFAUT = "http://localhost:8003"

# Compte de mesure : un clinicien, seul role autorise sur /routage/analyser.
_EMAIL_PAR_DEFAUT = "clinicien@aeris.local"
_MDP_PAR_DEFAUT = "Clinicien@aeris2026"


@dataclass
class Mesure:
    """Une mesure individuelle correspondant a une soumission d'image."""

    timestamp: str
    image_chemin: str
    pathologie: str
    label: str
    repetition: int
    destination: str
    raison_routage: str
    prediction_tb: int
    confiance_tb: float
    prediction_pn: int
    confiance_pn: float
    temps_inference_tb_ms: float
    temps_inference_pn_ms: float
    temps_total_ms: float
    cpu_edge: float = 0.0
    ram_edge: float = 0.0
    latence_reseau_ms: float = 0.0
    est_erreur: bool = False
    message_erreur: str = ""


def obtenir_token_jwt(
    client: httpx.Client,
    url_base: str = _URL_PAR_DEFAUT,
) -> str:
    """
    Obtient un token JWT pour l'authentification experimentale.

    Les identifiants viennent de l'environnement
    (``AERIS_EXP_EMAIL`` / ``AERIS_EXP_MOT_DE_PASSE``) et non d'une chaine
    codee en dur : le role **clinicien** est obligatoire pour
    ``/routage/analyser`` (le role admin est purement IT), et un secret de
    session n'a rien a faire dans un depot.
    """
    email = os.getenv("AERIS_EXP_EMAIL", _EMAIL_PAR_DEFAUT)
    mot_de_passe = os.getenv("AERIS_EXP_MOT_DE_PASSE", _MDP_PAR_DEFAUT)
    if not email or not mot_de_passe:
        raise RuntimeError(
            "Identifiants d'experimentation absents : renseigner "
            "AERIS_EXP_EMAIL et AERIS_EXP_MOT_DE_PASSE."
        )

    url = f"{url_base}/auth/connexion"
    reponse = client.post(
        url,
        json={"email": email, "mot_de_passe": mot_de_passe},
        timeout=10.0,
    )
    reponse.raise_for_status()
    return reponse.json()["acces_token"]


def soumettre_diagnostic(
    client: httpx.Client,
    chemin_image: Path,
    token_jwt: str,
    force_destination: str | None = None,
    url_base: str = _URL_PAR_DEFAUT,
) -> dict[str, Any]:
    """
    Soumet une image au moteur de decision via POST /routage/analyser.

    Args:
        client: Client HTTP httpx actif.
        chemin_image: Chemin vers le fichier image.
        token_jwt: Token JWT pour l'authentification.
        force_destination: "edge", "cloud" ou None (auto).
        url_base: URL de base du moteur de decision.

    Returns:
        Dictionnaire JSON de la reponse API.
    """
    url = f"{url_base}/routage/analyser"

    with open(chemin_image, "rb") as f:
        fichiers = {"fichier": (chemin_image.name, f, "image/png")}
        donnees = {}
        if force_destination:
            donnees["force_destination"] = force_destination

        reponse = client.post(
            url,
            files=fichiers,
            data=donnees,
            headers={"Authorization": f"Bearer {token_jwt}"},
            timeout=60.0,
        )
        reponse.raise_for_status()

    return reponse.json()


def mesurer_etat_systeme(
    client: httpx.Client,
    url_base: str = _URL_PAR_DEFAUT,
    token_jwt: str | None = None,
) -> dict[str, Any]:
    """
    Recupere l'etat systeme via GET /etat-systeme (reserve au role admin).

    L'endpoint est protege : sans jeton d'admin il repond 403, et l'appel
    etait silencieux (toutes les colonnes CPU/RAM du CSV restaient a 0).
    On n'en tire donc plus les metriques de l'experience : la source de
    verite est ``decision.metriques`` de la reponse d'analyse, mesuree par
    le moteur au moment exact de la decision.

    Returns:
        Dictionnaire contenant cpu, ram, latence, reseau_disponible, ou un
        dictionnaire vide si l'etat systeme est inaccessible.
    """
    if not token_jwt:
        return {}
    url = f"{url_base}/etat-systeme"
    try:
        reponse = client.get(
            url, timeout=10.0, headers={"Authorization": f"Bearer {token_jwt}"}
        )
        reponse.raise_for_status()
        return reponse.json()
    except (httpx.HTTPError, httpx.TimeoutException):
        return {}


def mesurer_latence_reseau(
    client: httpx.Client,
    url_base: str = _URL_PAR_DEFAUT,
) -> float:
    """
    Mesure la latence reseau en millisecondes via GET /sante.

    Returns:
        Latence en ms, ou 9999.0 en cas d'echec.
    """
    url = f"{url_base}/sante"
    debut = time.monotonic()
    try:
        reponse = client.get(url, timeout=5.0)
        reponse.raise_for_status()
        return (time.monotonic() - debut) * 1000
    except (httpx.HTTPError, httpx.TimeoutException):
        return 9999.0


def collecter_mesure(
    client: httpx.Client,
    chemin_image: Path,
    pathologie: str,
    label: str,
    repetition: int,
    token_jwt: str,
    force_destination: str | None = None,
    url_base: str = _URL_PAR_DEFAUT,
) -> Mesure:
    """
    Soumet une image et collecte toutes les metriques associees.

    Returns:
        Objet Mesure avec toutes les donnees collectees.
    """
    from datetime import datetime, timezone

    timestamp = datetime.now(timezone.utc).isoformat()

    # L'etat systeme global est facultatif : la mesure exploitee est celle
    # portee par la reponse d'analyse (voir decision.metriques plus bas).
    etat = mesurer_etat_systeme(client, url_base, token_jwt)

    debut_requete = time.monotonic()
    try:
        resultat = soumettre_diagnostic(client, chemin_image, token_jwt, force_destination, url_base)
        temps_total_ms = (time.monotonic() - debut_requete) * 1000

        # Extraire les resultats de la reponse (cle francaise de l'API)
        decision = resultat.get("decision", {})
        resultats = resultat.get("resultats") or resultat.get("results") or []
        metriques = decision.get("metriques", {}) if isinstance(decision, dict) else {}

        pred_tb, conf_tb, temps_tb = 0, 0.0, 0.0
        pred_pn, conf_pn, temps_pn = 0, 0.0, 0.0

        for r in resultats:
            pred_brute = r.get("prediction", 0)
            if isinstance(pred_brute, str):
                pred_normalisee = 1 if pred_brute.lower() == "positif" else 0
            else:
                pred_normalisee = int(pred_brute)

            if r.get("pathologie") == "tuberculose":
                pred_tb = pred_normalisee
                conf_tb = r.get("confiance", 0.0)
                temps_tb = r.get("temps_inference_ms", 0.0)
            elif r.get("pathologie") == "pneumonie":
                pred_pn = pred_normalisee
                conf_pn = r.get("confiance", 0.0)
                temps_pn = r.get("temps_inference_ms", 0.0)

        return Mesure(
            timestamp=timestamp,
            image_chemin=str(chemin_image),
            pathologie=pathologie,
            label=label,
            repetition=repetition,
            destination=decision.get("destination", "inconnu"),
            raison_routage=decision.get("raison", "inconnu"),
            prediction_tb=pred_tb,
            confiance_tb=conf_tb,
            prediction_pn=pred_pn,
            confiance_pn=conf_pn,
            temps_inference_tb_ms=temps_tb,
            temps_inference_pn_ms=temps_pn,
            temps_total_ms=temps_total_ms,
            cpu_edge=metriques.get("cpu_pourcentage", 0.0),
            ram_edge=metriques.get("ram_pourcentage", 0.0),
            latence_reseau_ms=metriques.get("latence_reseau_ms", 0.0),
        )

    except Exception as e:
        temps_total_ms = (time.monotonic() - debut_requete) * 1000
        # Un 401/403 (jeton expire, role insuffisant) n'est pas une panne du
        # moteur : le distinguer evite de conclure a tort a une panne systeme.
        code_http = getattr(getattr(e, "response", None), "status_code", None)
        if code_http in (401, 403):
            print(f"  [ERREUR AUTH] {code_http} sur /routage/analyser : {e}")
        return Mesure(
            timestamp=timestamp,
            image_chemin=str(chemin_image),
            pathologie=pathologie,
            label=label,
            repetition=repetition,
            destination="erreur",
            raison_routage=str(e),
            prediction_tb=0,
            confiance_tb=0.0,
            prediction_pn=0,
            confiance_pn=0.0,
            temps_inference_tb_ms=0.0,
            temps_inference_pn_ms=0.0,
            temps_total_ms=temps_total_ms,
            est_erreur=True,
            message_erreur=str(e),
        )


def executer_lot(
    images: list,
    nb_repetitions: int,
    force_destination: str | None = None,
    delai_entre_requetes_ms: int = 500,
    url_base: str = _URL_PAR_DEFAUT,
) -> list[Mesure]:
    """
    Execute un lot complet de soumissions.

    Args:
        images: Liste d'ImageTest a soumettre.
        nb_repetitions: Nombre de repetitions par image.
        force_destination: "edge", "cloud" ou None (auto).
        delai_entre_requetes_ms: Delai entre chaque requete.
        url_base: URL du moteur de decision.

    Returns:
        Liste de toutes les mesures collectees.
    """
    mesures: list[Mesure] = []
    total = len(images) * nb_repetitions
    compteur = 0

    destination_forcee = (
        force_destination if force_destination in ("edge", "cloud") else None
    )

    with httpx.Client() as client:
        try:
            token_jwt = obtenir_token_jwt(client, url_base)
        except Exception as e:
            print(f"  [ERREUR] Impossible d'obtenir le token JWT : {e}")
            return mesures

        for image in images:
            for rep in range(1, nb_repetitions + 1):
                compteur += 1
                print(
                    f"  [{compteur}/{total}] {image.pathologie}/"
                    f"{image.label} (rep {rep}/{nb_repetitions})"
                )

                if compteur % 20 == 0:
                    try:
                        token_jwt = obtenir_token_jwt(client, url_base)
                    except Exception as e:
                        print(f"  [AVERTISSEMENT] Renouvellement JWT echoue : {e}")

                mesure = collecter_mesure(
                    client=client,
                    chemin_image=image.chemin,
                    pathologie=image.pathologie,
                    label=image.label,
                    repetition=rep,
                    token_jwt=token_jwt,
                    force_destination=destination_forcee,
                    url_base=url_base,
                )
                mesures.append(mesure)

                if delai_entre_requetes_ms > 0:
                    time.sleep(delai_entre_requetes_ms / 1000)

    return mesures


def sauvegarder_mesures(mesures: list[Mesure], chemin_csv: Path) -> None:
    """Sauvegarde les mesures dans un fichier CSV."""
    if not mesures:
        print("  Aucune mesure a sauvegarder.")
        return

    chemin_csv.parent.mkdir(parents=True, exist_ok=True)

    en_tetes = list(asdict(mesures[0]).keys())

    with open(chemin_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=en_tetes)
        writer.writeheader()
        for mesure in mesures:
            writer.writerow(asdict(mesure))

    print(f"  Mesures sauvegardees : {chemin_csv} ({len(mesures)} lignes)")
