#!/usr/bin/env python3
"""
Scenario Tout-Cloud : envoi systematique de toutes les images vers le Cloud.

Usage :
    cd <racine_projet>
    python experimentations/scenario-tout-cloud/executer.py
"""

import json
import sys
from pathlib import Path

# Ajouter le racine du projet au path pour les imports
RACINE_PROJET = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RACINE_PROJET))

from experimentations.communs.prepareur_images import (
    charger_images_test,
    afficher_resume,
)
from experimentations.communs.collecteur_metriques import (
    executer_lot,
    sauvegarder_mesures,
)
from experimentations.communs.analyseur_resultats import (
    analyser_scenario,
    generer_rapport_texte,
    generer_rapport_json,
)


def main() -> None:
    """Execute le scenario Tout-Cloud."""
    # Charger la configuration
    config_path = Path(__file__).parent / "configuration.json"
    with open(config_path, "r", encoding="utf-8") as f:
        config = json.load(f)

    print(f"\n{'=' * 60}")
    print(f"SCENARIO : {config['nom'].upper()}")
    print(f"{config['description']}")
    print(f"{'=' * 60}")

    # Charger les images de test
    print("\nChargement des images de test...")
    images = charger_images_test(RACINE_PROJET)
    afficher_resume(images)

    if not images:
        print("  [ERREUR] Aucune image de test trouvee.")
        sys.exit(1)

    # Executer les soumissions
    print(f"\nExecution du scenario ({config['nb_repetitions']} repetitions par image)...")
    mesures = executer_lot(
        images=images,
        nb_repetitions=config["nb_repetitions"],
        force_destination=config["mode_routage"],
        delai_entre_requetes_ms=config["delai_entre_requetes_ms"],
    )

    # Sauvegarder les resultats bruts
    dossier_resultats = RACINE_PROJET / "experimentations" / "resultats" / "tout-cloud"
    csv_brut = dossier_resultats / "resultats-bruts.csv"
    sauvegarder_mesures(mesures, csv_brut)

    # Analyser et generer les rapports
    print("\nAnalyse des resultats...")
    stats = analyser_scenario(csv_brut, config["nom"])
    if stats:
        generer_rapport_texte(stats, dossier_resultats / "rapport.txt")
        generer_rapport_json(stats, dossier_resultats / "statistiques.json")

    print(f"\nScenario {config['nom']} termine.")
    print(f"Resultats dans : {dossier_resultats}")


if __name__ == "__main__":
    main()
