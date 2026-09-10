"""
Collecteur de metriques pour les scenarios d'experimentation.

Envoie des radiographies au moteur de decision et collecte les metriques
de performance (latence, temps d'inference, CPU/RAM, etc.).
"""

import csv
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

import httpx


# URL par defaut du moteur de decision (profile Docker)
_URL_PAR_DEFAUT = "http://localhost:8003"


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


def soumettre_diagnostic(
    client: httpx.Client,
    chemin_image: Path,
    force_destination: str | None = None,
    url_base: str = _URL_PAR_DEFAUT,
) -> dict[str, Any]:
    """
    Soumet une image au moteur de decision via POST /routage/analyser.

    Args:
        client: Client HTTP httpx actif.
        chemin_image: Chemin vers le fichier image.
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

        reponse = client.post(url, files=fichiers, data=donnees, timeout=60.0)
        reponse.raise_for_status()

    return reponse.json()


def mesurer_etat_systeme(
    client: httpx.Client,
    url_base: str = _URL_PAR_DEFAUT,
) -> dict[str, Any]:
    """
    Recupere l'etat systeme via GET /etat-systeme.

    Returns:
        Dictionnaire contenant cpu, ram, latence, reseau_disponible.
    """
    url = f"{url_base}/etat-systeme"
    try:
        reponse = client.get(url, timeout=10.0)
        reponse.raise_for_status()
        return reponse.json()
    except (httpx.HTTPError, httpx.TimeoutException):
        return {"cpu": 0.0, "ram": 0.0, "latence": 0.0, "reseau_disponible": False}


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

    # Recuperer l'etat systeme avant la requete
    etat = mesurer_etat_systeme(client, url_base)

    debut_requete = time.monotonic()
    try:
        resultat = soumettre_diagnostic(client, chemin_image, force_destination, url_base)
        temps_total_ms = (time.monotonic() - debut_requete) * 1000

        # Extraire les resultats de la reponse
        decision = resultat.get("decision", {})
        resultats = resultat.get("results", [])

        # Trouver les resultats TB et PN
        pred_tb, conf_tb, temps_tb = 0, 0.0, 0.0
        pred_pn, conf_pn, temps_pn = 0, 0.0, 0.0

        for r in resultats:
            if r.get("pathologie") == "tuberculose":
                pred_tb = r.get("prediction", 0)
                conf_tb = r.get("confiance", 0.0)
                temps_tb = r.get("temps_inference_ms", 0.0)
            elif r.get("pathologie") == "pneumonie":
                pred_pn = r.get("prediction", 0)
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
            cpu_edge=etat.get("cpu", 0.0),
            ram_edge=etat.get("ram", 0.0),
            latence_reseau_ms=etat.get("latence", 0.0),
        )

    except (httpx.HTTPError, httpx.TimeoutException, Exception) as e:
        temps_total_ms = (time.monotonic() - debut_requete) * 1000
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

    with httpx.Client() as client:
        for image in images:
            for rep in range(1, nb_repetitions + 1):
                compteur += 1
                print(
                    f"  [{compteur}/{total}] {image.pathologie}/"
                    f"{image.label} (rep {rep}/{nb_repetitions})"
                )

                mesure = collecter_mesure(
                    client=client,
                    chemin_image=image.chemin,
                    pathologie=image.pathologie,
                    label=image.label,
                    repetition=rep,
                    force_destination=force_destination,
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
