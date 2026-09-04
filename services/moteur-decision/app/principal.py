"""Point d'entree FastAPI du moteur de decision adaptatif."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator

from app.config import config
from app.routes.metriques import routeur_metriques
from app.routes.routage import routeur_routage
from app.routes.sante import routeur_sante

app = FastAPI(
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
        },
        "statut": "operationnel",
    }
