#!/usr/bin/env python3
"""
Compare les resultats des quatre scenarios d'experimentation.

Lit les CSV de resultats bruts de chaque scenario, calcule les
statistiques via l'analyseur commun, puis genere le tableau comparatif
(CSV + rapport texte) dans experimentations/resultats/comparaison/.

Usage :
    cd <racine_projet>
    python experimentations/comparer.py
"""

import sys
from pathlib import Path

RACINE_PROJET = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RACINE_PROJET))

from experimentations.communs.analyseur_resultats import (
    StatistiquesScenarii,
    analyser_scenario,
    generer_tableau_comparatif,
)

SCENARIOS = [
    ("tout-cloud", "Tout-Cloud"),
    ("tout-edge", "Tout-Edge"),
    ("adaptatif", "Adaptatif"),
    ("panne", "Tolerance-pannes"),
]


def main() -> None:
    """Analyse les 4 scenarios et genere le tableau comparatif."""
    dossier_resultats = RACINE_PROJET / "experimentations" / "resultats"

    scenarios: dict[str, StatistiquesScenarii] = {}
    for dossier, nom in SCENARIOS:
        csv_brut = dossier_resultats / dossier / "resultats-bruts.csv"
        if not csv_brut.exists():
            print(f"  [AVERTISSEMENT] CSV absent : {csv_brut}")
            continue
        print(f"Analyse du scenario {nom}...")
        stats = analyser_scenario(csv_brut, nom)
        if stats is not None:
            scenarios[nom] = stats

    if not scenarios:
        print("  [ERREUR] Aucun scenario analysable. Lancer les scenarios d'abord.")
        sys.exit(1)

    # Le nom clé des statistiques ("Tolerance-pannes") devient illisible
    # dans le comparatif : on le normalise pour l'ordre impose.
    noms_ordonnes = ["Tout-Cloud", "Tout-Edge", "Adaptatif", "Tolerance-pannes"]
    scenarios_ordonnes: dict[str, StatistiquesScenarii] = {}
    for nom in noms_ordonnes:
        if nom in scenarios:
            scenarios_ordonnes[nom] = scenarios[nom]
    for nom, stats in scenarios.items():
        if nom not in scenarios_ordonnes:
            scenarios_ordonnes[nom] = stats

    dossier_comparaison = dossier_resultats / "comparaison"
    chemin_csv = dossier_comparaison / "tableau-comparatif.csv"
    chemin_rapport = dossier_comparaison / "rapport.txt"

    generer_tableau_comparatif(
        scenarios_ordonnes,
        chemin_csv,
        chemin_rapport,
    )

    print(f"\nComparaison terminee : {dossier_comparaison}")


if __name__ == "__main__":
    main()