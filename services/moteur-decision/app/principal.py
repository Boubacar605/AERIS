"""Point d'entree FastAPI du moteur de decision adaptatif."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator

from app import persistance
from app.config import config
from app.logique_routage import registre_diagnostics
from app.routes.metriques import routeur_metriques
from app.routes.routage import routeur_routage
from app.routes.sante import routeur_sante

_logger = logging.getLogger("aeris.moteur")


def _configurer_logger_application() -> None:
    """Rend visibles les logs applicatifs (aeris.persistance, …).

    Uvicorn configure son propre root logger avant d'importer l'application :
    ``basicConfig`` serait alors sans effet. On attache donc un handler dédié
    au logger ``aeris`` (aucun impact sur les logs d'accès d'Uvicorn).
    """
    applicatif = logging.getLogger("aeris")
    if applicatif.handlers:
        return
    handler = logging.StreamHandler()
    handler.setFormatter(
        logging.Formatter("%(asctime)s | %(levelname)-7s | %(name)s | %(message)s")
    )
    applicatif.addHandler(handler)
    applicatif.setLevel(logging.INFO)
    applicatif.propagate = False


_configurer_logger_application()


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Cycle de vie : active la persistance puis réhydrate le registre.

    Si PostgreSQL est joignable, l'historique, le compteur et les moyennes
    d'inference sont restaurés depuis la base : un redémarrage du moteur ne
    fait plus rien perdre. Sans base configurée, le moteur reste opérationnel
    sur son registre mémoire (comportement d'origine).
    """
    persistance_activee = await persistance.demarrer()
    if persistance_activee:
        try:
            etat = await persistance.recuperer_etat_historique()
        except Exception as exc:  # noqa: BLE001 - la dégradation est voulue
            _logger.warning("Réhydratation impossible (%s) : registre mémoire seul", exc)
        else:
            registre_diagnostics.reinitialiser_etat(**etat)
            _logger.info(
                "Registre réhydraté : %d diagnostics, %d requêtes au total",
                len(etat["historique"]),
                etat["compteur"],
            )
    yield
    await persistance.arreter()


app = FastAPI(
    lifespan=lifespan,
    title="AERIS — Moteur de Decision",
    description=(
        "Moteur de decision adaptatif qui route les requetes d'inference "
        "vers l'Edge ou le Cloud selon l'etat des ressources et du reseau."
    ),
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

Instrumentator().instrument(app).expose(app)

app.include_router(routeur_sante)
app.include_router(routeur_routage, prefix="/routage", tags=["Routage"])
app.include_router(routeur_metriques, tags=["Metriques"])


@app.get("/")
async def racine() -> dict:
    """Endpoint racine avec informations de base du moteur."""
    return {
        "service": "moteur-decision",
        "version": "0.1.0",
        "seuils": {
            "cpu": config.seuil_cpu,
            "ram": config.seuil_ram,
            "latence_ms": config.seuil_latence_ms,
            "confiance_escalade": config.seuil_confiance_escalade,
            "confiance_indetermine": config.seuil_confiance_indetermine,
            "profilage_active": config.profilage_active,
            "profilage": {
                "seuil_ratio_carre_inf": config.seuil_ratio_carre_inf,
                "seuil_ratio_carre_sup": config.seuil_ratio_carre_sup,
                "seuil_ratio_pn": config.seuil_ratio_pn,
                "format_image_tb": config.format_image_tb,
                "format_image_pn": config.format_image_pn,
            },
        },
        "statut": "operationnel",
    }
