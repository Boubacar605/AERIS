"""Endpoints de diagnostic pour la detection de tuberculose."""

from fastapi import APIRouter, File, UploadFile

from app.coeur.inference import effectuer_inference
from app.schemas.schemas_diagnostic import ReponseDiagnostic, RequeteDiagnostic

routeur_diagnostic = APIRouter()


@routeur_diagnostic.post("/analyser", response_model=ReponseDiagnostic)
async def analyser_radiographie(fichier: UploadFile = File(...)) -> ReponseDiagnostic:
    """Analyse une radiographie thoracique pour detecter la tuberculose.

    Recoit une image (radiographie) et retourne la prediction du modele.
    """
    contenu_image = await fichier.read()
    resultat = await effectuer_inference(contenu_image)
    return resultat
