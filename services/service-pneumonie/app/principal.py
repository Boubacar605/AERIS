"""Point d'entree FastAPI du service de detection de la pneumonie."""

from fastapi import FastAPI
from prometheus_fastapi_instrumentator import Instrumentator

from app.config import config
from app.routes.diagnostic import routeur_diagnostic
from app.routes.sante import routeur_sante

app = FastAPI(
    title="AERIS — Service Pneumonie",
    description="Service d'inference IA pour la detection de la pneumonie par radiographie thoracique.",
    version="0.1.0",
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
