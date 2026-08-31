"""Module d'inference pour la detection de la pneumonie.

Charge le modele CNN pre-entraine (Keras .h5) et effectue les predictions
sur les radiographies thoraciques. Le modele provient du notebook Kaggle
"Pneumonia Detection using CNN (92.6% Accuracy)" (madz2000), entraine sur
le dataset Chest X-Ray Images (Kermany et al.).

Specifications du modele :
- Entree : image 150x150 pixels, 1 canal (niveaux de gris), normalisee [0, 1]
- Sortie : sigmoid 1 neurone (PNEUMONIA=0, NORMAL=1)
- Seuil de decision : 0.5
"""

import io
import logging

import numpy as np
from PIL import Image

from app.config import config
from app.schemas.schemas_diagnostic import ReponseDiagnostic

logger = logging.getLogger(__name__)

TAILLE_IMAGE = 150

_modele = None


def charger_modele() -> None:
    """Charge le modele de detection de pneumonie depuis le disque."""
    global _modele
    if _modele is not None:
        return

    from tensorflow.keras.models import load_model

    chemin = config.service_pn_chemin_modele
    logger.info("Chargement du modele pneumonie depuis %s", chemin)
    _modele = load_model(chemin)
    logger.info("Modele pneumonie charge avec succes")


def preprocesser_image(contenu_image: bytes) -> np.ndarray:
    """Preprocesse l'image brute pour la rendre compatible avec le modele.

    - Conversion en niveaux de gris (1 canal)
    - Redimensionnement a 150x150
    - Normalisation des pixels dans [0, 1]
    - Reshape pour le CNN : (1, 150, 150, 1)
    """
    image = Image.open(io.BytesIO(contenu_image))
    image = image.convert("L")
    image = image.resize((TAILLE_IMAGE, TAILLE_IMAGE))
    tableau = np.array(image, dtype=np.float32) / 255.0
    tableau = tableau.reshape(1, TAILLE_IMAGE, TAILLE_IMAGE, 1)
    return tableau


async def effectuer_inference(contenu_image: bytes) -> ReponseDiagnostic:
    """Effectue l'inference sur une image de radiographie thoracique."""
    charger_modele()
    image_preprocessee = preprocesser_image(contenu_image)
    prediction_brute = _modele.predict(image_preprocessee)

    # Sigmoid : valeur proche de 0 = PNEUMONIA, proche de 1 = NORMAL
    score = float(prediction_brute[0][0])
    est_pneumonie = score < 0.5
    confiance = (1.0 - score) if est_pneumonie else score

    return ReponseDiagnostic(
        pathologie="pneumonie",
        prediction="positif" if est_pneumonie else "negatif",
        confiance=round(confiance, 4),
        mode_deploiement=config.mode_deploiement,
    )
