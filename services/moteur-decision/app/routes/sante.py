"""Endpoint de verification de sante (healthcheck) du moteur de decision."""

from fastapi import APIRouter

routeur_sante = APIRouter(tags=["Sante"])


@routeur_sante.get("/sante")
async def verifier_sante() -> dict:
    """Verifie que le moteur de decision est operationnel."""
    return {"statut": "ok", "service": "moteur-decision"}
