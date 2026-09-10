"""
Prepareur d'images pour les scenarios d'experimentation.

Charge les images de test depuis donnees/test-tuberculose/ et donnees/test-pneumonie/
et les prepare pour soumission au moteur de decision.
"""

import os
from dataclasses import dataclass
from pathlib import Path


# Chemins relatifs vers les jeux de test
_CHEMIN_TB = Path("donnees/test-tuberculose")
_CHEMIN_PN = Path("donnees/test-pneumonie")

# Extensions acceptees
_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".gif"}


@dataclass
class ImageTest:
    """ Representation d'une image de test pour les experimentations. """

    chemin: Path
    label: str  # "normal" ou "tuberculose"/"pneumonie"
    pathologie: str  # "tuberculose" ou "pneumonie"

    def __str__(self) -> str:
        return f"{self.pathologie}/{self.label}/{self.chemin.name}"


def charger_images_test(racine_projet: Path | None = None) -> list[ImageTest]:
    """
    Charge toutes les images de test disponibles dans les dossiers de donnees.

    Args:
        racine_projet: Racine du projet AERIS. Si None, utilise le repertoire
                       de travail courant.

    Returns:
        Liste d'ImageTest representant chaque image trouvee.
    """
    if racine_projet is None:
        racine_projet = Path.cwd()

    images: list[ImageTest] = []

    # Charger les images tuberculose
    images.extend(_charger_dossier_pathologie(racine_projet / _CHEMIN_TB, "tuberculose"))

    # Charger les images pneumonie
    images.extend(_charger_dossier_pathologie(racine_projet / _CHEMIN_PN, "pneumonie"))

    return images


def _charger_dossier_pathologie(dossier: Path, pathologie: str) -> list[ImageTest]:
    """Charge les images d'un dossier de pathologie organise par classe."""
    images: list[ImageTest] = []

    if not dossier.exists():
        print(f"  [AVERTISSEMENT] Dossier non trouve : {dossier}")
        return images

    for sous_dossier in sorted(dossier.iterdir()):
        if not sous_dossier.is_dir():
            continue

        label = sous_dossier.name.lower()  # "normal", "tuberculose", "pneumonie"

        for fichier in sorted(sous_dossier.iterdir()):
            if fichier.is_file() and fichier.suffix.lower() in _EXTENSIONS:
                images.append(
                    ImageTest(
                        chemin=fichier,
                        label=label,
                        pathologie=pathologie,
                    )
                )

    return images


def afficher_resume(images: list[ImageTest]) -> None:
    """Affiche un resume du jeu d'images charge."""
    par_pathologie: dict[str, dict[str, int]] = {}
    for img in images:
        if img.pathologie not in par_pathologie:
            par_pathologie[img.pathologie] = {}
        par_pathologie[img.pathologie][img.label] = (
            par_pathologie[img.pathologie].get(img.label, 0) + 1
        )

    print(f"\n  Images chargees : {len(images)} au total")
    for pathologie, classes in par_pathologie.items():
        for label, count in classes.items():
            print(f"    - {pathologie}/{label} : {count} images")
