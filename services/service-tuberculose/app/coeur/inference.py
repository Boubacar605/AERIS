"""Module d'inference pour la detection de la tuberculose.

Supporte deux modes de deploiement :

Edge (modele leger, CNN simple) :
- Entree : 96x96 pixels, 3 canaux (RGB), normalisee [0, 1]
- Sortie : softmax 2 classes [Normal=0, Tuberculosis=1]
- Source : vbookshelf, datasets Shenzhen + Montgomery

Cloud (modele complet, DenseNet121 transfer learning) :
- Entree : 320x320 pixels, 3 canaux (RGB), samplewise normalization
- Sortie : sigmoid 1 neurone (0=Normal, 1=Tuberculosis)
- Source : sanphats, dataset TB Chest Radiography Database
"""

import io
import logging
import time

import numpy as np
from PIL import Image

from app.config import config
from app.schemas.schemas_diagnostic import ReponseDiagnostic

logger = logging.getLogger(__name__)

_modele = None

SPECS = {
    "edge": {"taille": 96, "canaux": "RGB", "normalisation": "rescale"},
    "cloud": {"taille": 320, "canaux": "RGB", "normalisation": "samplewise"},
}


def charger_modele() -> None:
    """Charge le modele selon le mode de deploiement (edge ou cloud)."""
    global _modele
    if _modele is not None:
        return

    from tensorflow.keras.models import load_model

    chemin = config.chemin_modele
    logger.info(
        "Chargement du modele tuberculose [%s] depuis %s",
        config.mode_deploiement,
        chemin,
    )
    _modele = load_model(chemin)
    logger.info("Modele tuberculose charge avec succes")


def preprocesser_image(contenu_image: bytes) -> np.ndarray:
    """Preprocesse l'image selon le mode de deploiement."""
    spec = SPECS[config.mode_deploiement]
    taille = spec["taille"]

    image = Image.open(io.BytesIO(contenu_image))
    image = image.convert("RGB")
    image = image.resize((taille, taille))
    tableau = np.array(image, dtype=np.float32)

    if spec["normalisation"] == "rescale":
        tableau = tableau / 255.0
    else:
        tableau = (tableau - tableau.mean()) / (tableau.std() + 1e-7)

    return np.expand_dims(tableau, axis=0)


def interpreter_prediction(prediction: np.ndarray) -> tuple[bool, float]:
    """Interprete la sortie du modele selon le mode."""
    if config.mode_deploiement == "edge":
        indice = int(np.argmax(prediction[0]))
        confiance = float(prediction[0][indice])
        est_tuberculose = indice == 1
    else:
        score = float(prediction[0][0])
        est_tuberculose = score >= 0.5
        confiance = score if est_tuberculose else (1.0 - score)

    return est_tuberculose, round(confiance, 4)


async def effectuer_inference(contenu_image: bytes) -> ReponseDiagnostic:
    """Effectue l'inference sur une image de radiographie thoracique."""
    charger_modele()

    debut = time.time()
    image_preprocessee = preprocesser_image(contenu_image)
    predictions = _modele.predict(image_preprocessee)
    temps_inference_ms = round((time.time() - debut) * 1000, 2)

    est_tuberculose, confiance = interpreter_prediction(predictions)

    logger.info(
        "Inference TB [%s] : %s (confiance=%.4f, temps=%sms)",
        config.mode_deploiement,
        "positif" if est_tuberculose else "negatif",
        confiance,
        temps_inference_ms,
    )

    return ReponseDiagnostic(
        pathologie="tuberculose",
        prediction="positif" if est_tuberculose else "negatif",
        confiance=confiance,
        mode_deploiement=config.mode_deploiement,
        temps_inference_ms=temps_inference_ms,
    )
