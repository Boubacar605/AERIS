"""Endpoint de verification de sante (healthcheck) du service."""

from fastapi import APIRouter

routeur_sante = APIRouter(tags=["Sante"])


@routeur_sante.get("/sante")
async def verifier_sante() -> dict:
    """Verifie que le service est operationnel."""
    return {"statut": "ok", "service": "service-tuberculose"}
