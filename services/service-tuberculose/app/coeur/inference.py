"""Module d'inference pour la detection de la tuberculose.

Charge le modele CNN pre-entraine (Keras .h5) et effectue les predictions
sur les radiographies thoraciques. Le modele provient du notebook Kaggle
"Tuberculosis (TB) Analyzer + Web App" (vbookshelf), entraine sur les
datasets Shenzhen (Chine) et Montgomery (USA).

Specifications du modele :
- Entree : image 96x96 pixels, 3 canaux (RGB), normalisee [0, 1]
- Sortie : softmax 2 classes [Normal=0, Tuberculosis=1]
"""

import io
import logging

import numpy as np
from PIL import Image

from app.config import config
from app.schemas.schemas_diagnostic import ReponseDiagnostic

logger = logging.getLogger(__name__)

TAILLE_IMAGE = 96
CLASSES = ["Normal", "Tuberculosis"]

_modele = None


def charger_modele() -> None:
    """Charge le modele de detection de tuberculose depuis le disque."""
    global _modele
    if _modele is not None:
        return

    from tensorflow.keras.models import load_model

    chemin = config.service_tb_chemin_modele
    logger.info("Chargement du modele tuberculose depuis %s", chemin)
    _modele = load_model(chemin)
    logger.info("Modele tuberculose charge avec succes")


def preprocesser_image(contenu_image: bytes) -> np.ndarray:
    """Preprocesse l'image brute pour la rendre compatible avec le modele.

    - Conversion en RGB (3 canaux)
    - Redimensionnement a 96x96
    - Normalisation des pixels dans [0, 1]
    """
    image = Image.open(io.BytesIO(contenu_image))
    image = image.convert("RGB")
    image = image.resize((TAILLE_IMAGE, TAILLE_IMAGE))
    tableau = np.array(image, dtype=np.float32) / 255.0
    tableau = np.expand_dims(tableau, axis=0)
    return tableau


async def effectuer_inference(contenu_image: bytes) -> ReponseDiagnostic:
    """Effectue l'inference sur une image de radiographie thoracique."""
    charger_modele()
    image_preprocessee = preprocesser_image(contenu_image)
    predictions = _modele.predict(image_preprocessee)

    indice_classe = int(np.argmax(predictions[0]))
    confiance = float(predictions[0][indice_classe])
    est_tuberculose = CLASSES[indice_classe] == "Tuberculosis"

    return ReponseDiagnostic(
        pathologie="tuberculose",
        prediction="positif" if est_tuberculose else "negatif",
        confiance=confiance,
        mode_deploiement=config.mode_deploiement,
    )
