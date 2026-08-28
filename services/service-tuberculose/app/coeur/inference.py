"""Module d'inference pour la detection de la tuberculose.

Ce module charge le modele pre-entraine et effectue les predictions
sur les radiographies thoraciques soumises.

TODO: Integrer le vrai modele Keras/TensorFlow (.h5 ou SavedModel)
      issu du notebook Kaggle (CNN, datasets Shenzhen + Montgomery).
"""

import numpy as np

from app.config import config
from app.schemas.schemas_diagnostic import ReponseDiagnostic


async def charger_modele() -> None:
    """Charge le modele de detection de tuberculose depuis le disque.

    TODO: Implementer le chargement reel avec tensorflow.keras.models.load_model()
    """
    pass


async def preprocesser_image(contenu_image: bytes) -> np.ndarray:
    """Preprocesse l'image brute pour la rendre compatible avec le modele.

    TODO: Implementer le redimensionnement (224x224 ou taille attendue par le CNN),
          normalisation des pixels [0, 1], conversion en niveaux de gris si necessaire.
    """
    return np.zeros((1, 224, 224, 1), dtype=np.float32)


async def effectuer_inference(contenu_image: bytes) -> ReponseDiagnostic:
    """Effectue l'inference sur une image de radiographie.

    TODO: Remplacer le stub par l'appel reel au modele charge.
    """
    _image_preprocessee = await preprocesser_image(contenu_image)

    # Stub : simule une prediction
    confiance_simulee = 0.85
    prediction = "positif" if confiance_simulee > 0.5 else "negatif"

    return ReponseDiagnostic(
        pathologie="tuberculose",
        prediction=prediction,
        confiance=confiance_simulee,
        mode_deploiement=config.mode_deploiement,
    )
