"""Limiteur de debit en memoire pour les surfaces sensibles du moteur.

Protege les routes de devinette de secret — connexion soignant et acces
patient par OTP — contre le bourrage d'identifiants (brute force). Aucune
dependance externe (pas de Redis) : le prototype tient sur un seul processus
moteur, une fenetre glissante en memoire suffit.

Choix assumes :
- seules les surfaces d'authentification sont bornees. ``/routage/analyser``
  n'est **volontairement pas** limitee : les scenarios d'experimentation la
  saturent a dessein pour mesurer le routage, et Prometheus scrape ``/metrics``
  en continu sans en-tete ``Origin``. Borner ces routes fausserait les mesures
  sans rien proteger (elles exigent deja un JWT clinicien valide).
- la cle de comptage est l'adresse cliente (premier hop de
  ``X-Forwarded-For`` si present, sinon l'adresse de transport). Sous Tailscale
  Funnel toutes les requetes arrivent de la boucle locale : sans lecture de
  ``X-Forwarded-For``, tous les patients partageraient le meme compteur.
- un depassement repond ``429`` au format d'erreur du projet
  (``{"detail": ...}``), jamais un texte libre.

Le compteur est en memoire vive : un redemarrage du moteur remet les compteurs
a zero, ce qui est acceptable pour un filet anti-bourrage (le verrou des 5
tentatives OTP, lui, est persistant en base).
"""

from __future__ import annotations

import time
from collections import deque
from typing import Callable

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import config

# Fenetre glissante : nombre d'occurrences conservees par cle.
_FENETRE_SECONDES = 60

# Historique partage par cle ``route|adresse``. Au niveau module (et non de
# l'instance du middleware) pour rester unique et remis a zero par les tests.
_historique: dict[str, deque[float]] = {}


def reinitialiser() -> None:
    """Vide l'historique du limiteur (tests et redemarrages controles)."""
    _historique.clear()


def _plafonds() -> dict[str, int]:
    """Plafonds par minute des routes limitees, lus dans la configuration.

    Fonction (et non constante) pour que les tests puissent ajuster les
    plafonds via la configuration sans recreer l'application.
    """
    return {
        "/auth/connexion": config.limite_connexion_par_minute,
        "/acces-resultat": config.limite_acces_resultat_par_minute,
    }


def _adresse_cliente(request: Request) -> str:
    """Adresse retenue pour le comptage (premier hop du proxy, sinon transport)."""
    transmise = request.headers.get("x-forwarded-for")
    if transmise:
        return transmise.split(",")[0].strip()
    client = request.client
    return client.host if client is not None else "inconnu"


class LimiteurDebit(BaseHTTPMiddleware):
    """Applique une fenetre glissante aux routes listees par ``_plafonds``."""

    def _depasse(self, cle: str, plafond: int, maintenant: float) -> bool:
        """Enregistre l'appel et dit s'il franchit le plafond de la fenetre."""
        horodatages = _historique.setdefault(cle, deque())
        limite_basse = maintenant - _FENETRE_SECONDES
        while horodatages and horodatages[0] < limite_basse:
            horodatages.popleft()
        if len(horodatages) >= plafond:
            return True
        horodatages.append(maintenant)
        return False

    async def dispatch(self, request: Request, call_next: Callable):
        plafonds = _plafonds()
        plafond = plafonds.get(request.url.path)
        if plafond is not None and plafond > 0:
            cle = f"{request.url.path}|{_adresse_cliente(request)}"
            if self._depasse(cle, plafond, time.monotonic()):
                return JSONResponse(
                    status_code=429,
                    content={
                        "detail": (
                            "Trop de requetes sur cette route. "
                            "Reessayez dans une minute."
                        )
                    },
                )
        return await call_next(request)