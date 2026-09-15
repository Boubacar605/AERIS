"""Route publique d'acces aux resultats patient via OTP.

Pas d'authentification requise : le code OTP + le contact (email ou numero
WhatsApp) suffisent. Le code est consomme a la premiere utilisation.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app import persistance
from app.whatsapp import normaliser_numero

routeur_acces = APIRouter(tags=["Acces patient"])


class AccesResultatRequete(BaseModel):
    code_otp: str
    email: str | None = None
    telephone: str | None = None


@routeur_acces.post("/acces-resultat")
async def acceder_resultat(requete: AccesResultatRequete) -> dict:
    """Valide un OTP et retourne les resultats du patient."""
    if not persistance.active():
        raise HTTPException(status_code=503, detail="Base de donnees indisponible")

    if not requete.email and not requete.telephone:
        raise HTTPException(
            status_code=422,
            detail="Email ou telephone requis pour verifier un OTP",
        )

    # L'adresse de destination stockée sur le code est le contact qui l'a
    # reçu (email ou numéro WhatsApp normalisé) : on cherche donc la même
    # forme que celle saisie.
    destination = requete.email or normaliser_numero(requete.telephone or "")
    patient = await persistance.verifier_et_consommer_otp(
        code=requete.code_otp,
        destination=destination,
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
