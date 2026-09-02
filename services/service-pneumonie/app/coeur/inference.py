"""Module d'inference pour la detection de la pneumonie.

Supporte deux modes de deploiement :

Edge (modele leger, CNN simple) :
- Entree : 150x150 pixels, 1 canal (niveaux de gris), normalisee [0, 1]
- Sortie : sigmoid 1 neurone (PNEUMONIA=0, NORMAL=1)
- Source : madz2000, dataset Chest X-Ray Images (Kermany)

Cloud (modele complet, DenseNet121 transfer learning) :
- Entree : 320x320 pixels, 3 canaux (RGB), samplewise normalization
- Sortie : sigmoid 1 neurone (NORMAL=0, PNEUMONIA=1)
- Source : AERIS (adapte de sanphats), dataset Chest X-Ray Images (Kermany)
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
    "edge": {"taille": 150, "canaux": "L", "normalisation": "rescale"},
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
        "Chargement du modele pneumonie [%s] depuis %s",
        config.mode_deploiement,
        chemin,
    )
    _modele = load_model(chemin)
    logger.info("Modele pneumonie charge avec succes")


def preprocesser_image(contenu_image: bytes) -> np.ndarray:
    """Preprocesse l'image selon le mode de deploiement."""
    spec = SPECS[config.mode_deploiement]
    taille = spec["taille"]

    image = Image.open(io.BytesIO(contenu_image))
    image = image.convert(spec["canaux"])
    image = image.resize((taille, taille))
    tableau = np.array(image, dtype=np.float32)

    if spec["normalisation"] == "rescale":
        tableau = tableau / 255.0
        tableau = tableau.reshape(1, taille, taille, 1)
    else:
        tableau = (tableau - tableau.mean()) / (tableau.std() + 1e-7)
        tableau = np.expand_dims(tableau, axis=0)

    return tableau


def interpreter_prediction(prediction: np.ndarray) -> tuple[bool, float]:
    """Interprete la sortie du modele selon le mode.

    Edge : sigmoid ou score < 0.5 = PNEUMONIA, >= 0.5 = NORMAL
    Cloud : sigmoid ou score >= 0.5 = PNEUMONIA, < 0.5 = NORMAL
    """
    score = float(prediction[0][0])

    if config.mode_deploiement == "edge":
        est_pneumonie = score < 0.5
        confiance = (1.0 - score) if est_pneumonie else score
    else:
        est_pneumonie = score >= 0.5
        confiance = score if est_pneumonie else (1.0 - score)

    return est_pneumonie, round(confiance, 4)


async def effectuer_inference(contenu_image: bytes) -> ReponseDiagnostic:
    """Effectue l'inference sur une image de radiographie thoracique."""
    charger_modele()

    debut = time.time()
    image_preprocessee = preprocesser_image(contenu_image)
    prediction_brute = _modele.predict(image_preprocessee)
    temps_inference_ms = round((time.time() - debut) * 1000, 2)

    est_pneumonie, confiance = interpreter_prediction(prediction_brute)

    logger.info(
        "Inference PN [%s] : %s (confiance=%.4f, temps=%sms)",
        config.mode_deploiement,
        "positif" if est_pneumonie else "negatif",
        confiance,
        temps_inference_ms,
    )

    return ReponseDiagnostic(
        pathologie="pneumonie",
        prediction="positif" if est_pneumonie else "negatif",
        confiance=confiance,
        mode_deploiement=config.mode_deploiement,
        temps_inference_ms=temps_inference_ms,
    )
