"""Route publique d'acces aux resultats patient via OTP.

Pas d'authentification requise : le code OTP + le contact (email ou numero
WhatsApp) suffisent. Le code est consomme a la premiere utilisation.
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app import persistance
from app.whatsapp import normaliser_numero

routeur_acces = APIRouter(tags=["Acces patient"])


class AccesResultatRequete(BaseModel):
    code_otp: str
    email: str | None = None
    telephone: str | None = None


async def _verifier_et_renvoyer(code_otp: str, email: str | None, telephone: str | None) -> dict:
    """Logique commune de vérification OTP (POST et GET)."""
    if not persistance.active():
        raise HTTPException(status_code=503, detail="Base de donnees indisponible")

    if not email and not telephone:
        raise HTTPException(
            status_code=422,
            detail="Email ou telephone requis pour verifier un OTP",
        )

    destination = email or normaliser_numero(telephone or "")
    patient = await persistance.verifier_et_consommer_otp(
        code=code_otp,
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


@routeur_acces.post("/acces-resultat")
async def acceder_resultat(requete: AccesResultatRequete) -> dict:
    """Valide un OTP et retourne les resultats du patient (POST)."""
    return await _verifier_et_renvoyer(requete.code_otp, requete.email, requete.telephone)


@routeur_acces.get("/acces-resultat")
async def acceder_resultat_get(
    code_otp: str = Query(...),
    email: str | None = Query(None),
    telephone: str | None = Query(None),
) -> dict:
    """Valide un OTP et retourne les resultats du patient (GET).

    Variante GET pour les navigateurs mobiles qui ne parviennent pas a envoyer
    de POST via le proxy Tailscale Funnel (Safari iOS).
    """
    return await _verifier_et_renvoyer(code_otp, email, telephone)
