"""Point d'entree FastAPI du service de detection de la pneumonie."""

import logging

from contextlib import asynccontextmanager

from fastapi import FastAPI
from prometheus_fastapi_instrumentator import Instrumentator

from app.config import config
from app.coeur.inference import charger_modele
from app.routes.diagnostic import routeur_diagnostic
from app.routes.sante import routeur_sante

logger = logging.getLogger(__name__)


@asynccontextmanager
async def cycle_de_vie(app: FastAPI):
    """Charge le modele au demarrage du service."""
    logger.info("Demarrage du service pneumonie (mode: %s)", config.mode_deploiement)
    charger_modele()
    yield
    logger.info("Arret du service pneumonie")


app = FastAPI(
    title="AERIS — Service Pneumonie",
    description="Service d'inference IA pour la detection de la pneumonie par radiographie thoracique.",
    version="0.1.0",
    lifespan=cycle_de_vie,
)

Instrumentator().instrument(app).expose(app)

app.include_router(routeur_sante)
app.include_router(routeur_diagnostic, prefix="/diagnostic", tags=["Diagnostic"])


@app.get("/")
async def racine() -> dict:
    """Endpoint racine avec informations de base du service."""
    return {
        "service": "service-pneumonie",
        "version": "0.1.0",
        "mode": config.mode_deploiement,
        "statut": "operationnel",
    }
