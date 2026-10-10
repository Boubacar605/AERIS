"""Registre en memoire des diagnostics et metriques temps reel.

Centralise l'etat partage du moteur de decision :
- un buffer circulaire des derniers diagnostics (alimente par /routage/analyser),
- un compteur global de requetes,
- une fenetre glissante pour le debit de traitement,
- les temps moyens d'inference observes par destination (Edge/Cloud).

Permet au tableau de bord d'afficher l'activite reelle du systeme sans
dependre d'une base de donnees externe. Les donnees sont reinitialisees
au redemarrage du processus, ce qui est suffisant pour la demo.
"""

import time
from collections import deque
from datetime import datetime
from typing import Any

CAPACITE_HISTORIQUE = 100
FENETRE_DEBIT_SECONDES = 60.0

_historique: deque[dict[str, Any]] = deque(maxlen=CAPACITE_HISTORIQUE)
_horodatages_traces: deque[float] = deque(maxlen=CAPACITE_HISTORIQUE)
_compteur_requetes = 0
_prochain_identifiant = 1

_temps_inference_edge: list[float] = []
_temps_inference_cloud: list[float] = []


def incrementer_compteur() -> int:  # pragma: no cover - simple compteur
    """Enregistre une nouvelle requete et retourne son numero."""
    global _compteur_requetes
    _compteur_requetes += 1
    _horodatages_traces.append(time.monotonic())
    return _compteur_requetes


def enregistrer_diagnostic(
    destination: str,
    resultats: list[dict[str, Any]],
    temps_total_ms: float,
    escalades: list[dict[str, Any]] | None = None,
    filtrage: dict[str, Any] | None = None,
) -> int:
    """Ajoute un diagnostic realise au buffer circulaire.

    Retourne l'identifiant attribue au diagnostic. Le profilage image et le
    triage des specialistes (``filtrage``) sont preserves quand disponibles.
    """
    global _prochain_identifiant
    identifiant = _prochain_identifiant
    _prochain_identifiant += 1

    _historique.appendleft(
        {
            "id": identifiant,
            "horodatage": datetime.now().isoformat(timespec="seconds"),
            "destination": destination,
            "resultats": resultats,
            "escalades": escalades or [],
            "filtrage": filtrage,
            "temps_total_ms": round(temps_total_ms, 1),
            "statut": "completed",
        }
    )

    # Accumulation des temps d'inference par SOURCE reelle pour les moyennes.
    # Apres escalade, les sources peuvent etre mixtes (TB depuis cloud, PN
    # depuis edge) : on ne fausse pas les moyennes en utilisant destination.
    for resultat in resultats:
        temps = resultat.get("temps_inference_ms", 0.0)
        source = resultat.get("source", destination)
        if source == "edge":
            _temps_inference_edge.append(temps)
        elif source == "cloud":
            _temps_inference_cloud.append(temps)

    return identifiant


def obtenir_derniers_diagnostics(limite: int = CAPACITE_HISTORIQUE) -> list[dict[str, Any]]:
    """Retourne les derniers diagnostics, du plus recent au plus ancien."""
    return list(_historique)[:limite]


def reinitialiser_etat(
    *,
    historique: list[dict[str, Any]],
    compteur: int,
    temps_edge: list[float],
    temps_cloud: list[float],
) -> None:
    """Restaure l'etat du registre depuis la base persistanee.

    Appelee au demarrage du moteur (rehydratation) : l'historique, le
    compteur de requetes et les temps d'inference par source retrouvent les
    valeurs d'avant le redemarrage. La rehydratation n'est pas un repli :
    elle part de donnees reelles persistees dans PostgreSQL.
    """
    global _historique, _compteur_requetes, _prochain_identifiant
    global _temps_inference_edge, _temps_inference_cloud

    _historique = deque(historique, maxlen=CAPACITE_HISTORIQUE)
    _compteur_requetes = compteur
    _prochain_identifiant = max((e.get("id", 0) for e in historique), default=0) + 1
    _temps_inference_edge = list(temps_edge)
    _temps_inference_cloud = list(temps_cloud)


def statistiques() -> dict[str, Any]:
    """Calcule les statistiques globales depuis l'historique."""
    total = len(_historique)
    reussis = sum(1 for entree in _historique if entree["statut"] == "completed")
    edge_entries = [e for e in _historique if e["destination"] == "edge"]
    cloud_entries = [e for e in _historique if e["destination"] == "cloud"]

    def _moyenne(liste: list[float]) -> float:
        return round(sum(liste) / len(liste), 1) if liste else 0.0

    return {
        "total": total,
        "taux_reussite": round(reussis / total, 3) if total else 0.0,
        "latence_moyenne_edge_ms": _moyenne([e["temps_total_ms"] for e in edge_entries]),
        "latence_moyenne_cloud_ms": _moyenne([e["temps_total_ms"] for e in cloud_entries]),
        "repartition": {
            "edge": len(edge_entries),
            "cloud": len(cloud_entries),
        },
    }


def metriques_temps_reel() -> dict[str, Any]:
    """Metriques de debit et d'inference observees en temps reel."""
    main = time.monotonic()
    debut_fenetre = main - FENETRE_DEBIT_SECONDES
    nombre_recent = sum(1 for horodatage in _horodatages_traces if horodatage >= debut_fenetre)

    def _moyenne(liste: list[float]) -> float:
        return round(sum(liste) / len(liste), 1) if liste else 0.0

    return {
        "debit_requete_par_minute": nombre_recent,
        "temps_moyen_inference_edge_ms": _moyenne(_temps_inference_edge),
        "temps_moyen_inference_cloud_ms": _moyenne(_temps_inference_cloud),
        "nb_requetes_total": _compteur_requetes,
    }
