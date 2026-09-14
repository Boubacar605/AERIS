"""Route publique d'acces aux resultats patient via OTP.

Pas d'authentification requise : le code OTP + email suffisent.
Le code est consomme a la premiere utilisation (one-time).
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app import persistance

routeur_acces = APIRouter(tags=["Acces patient"])


class AccesResultatRequete(BaseModel):
    code_otp: str
    email: str


@routeur_acces.post("/acces-resultat")
async def acceder_resultat(requete: AccesResultatRequete) -> dict:
    """Valide un OTP et retourne les resultats du patient."""
    if not persistance.active():
        raise HTTPException(status_code=503, detail="Base de donnees indisponible")

    patient = await persistance.verifier_et_consommer_otp(
        code=requete.code_otp,
        email=requete.email,
    )

    if not patient:
        raise HTTPException(
            status_code=401,
            detail="Code OTP invalide, expire ou epuise",
        )

    resultats = await persistance.obtenir_resultats_par_patient(patient.id_patient)

    return {
        "patient": {
            "code_patient": patient.code_patient,
            "nom_complet": patient.nom_complet,
        },
        "resultats": resultats,
    }
