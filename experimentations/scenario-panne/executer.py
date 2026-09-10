#!/usr/bin/env python3
"""
Scenario Tolerance aux pannes : verification de la bascule automatique
Edge → Cloud lors d'une panne du service Edge.

Usage :
    cd <racine_projet>
    python experimentations/scenario-panne/executer.py
"""

import json
import sys
import threading
import time
from pathlib import Path
from dataclasses import asdict

RACINE_PROJET = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RACINE_PROJET))

from experimentations.communs.prepareur_images import (
    charger_images_test,
    afficher_resume,
)
from experimentations.communs.collecteur_metriques import (
    Mesure,
    executer_lot,
    sauvegarder_mesures,
)
from experimentations.communs.generateur_charge import GenerateurCharge
from experimentations.communs.analyseur_resultats import (
    analyser_scenario,
    generer_rapport_texte,
    generer_rapport_json,
)


def main() -> None:
    """Execute le scenario de tolerance aux pannes."""
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

    # Generer les verifications attendues
    verifications = config.get("verifications", [])
    destinations_attendues = {v["phase"]: v["destination_attendue"] for v in verifications}

    # Initialiser le generateur de charge
    generateur = GenerateurCharge(est_docker=True)
    profils = config.get("profils_charge", [])

    # Lancer la sequence de charge dans un thread separate
    print("\nDemarrage de la sequence de profils de charge...")
    thread_charge = threading.Thread(
        target=generateur.appliquer_profil_sequence,
        args=(profils,),
        daemon=True,
    )
    thread_charge.start()
    time.sleep(2)

    # Executer les soumissions
    print(f"\nExecution du scenario ({config['nb_repetitions']} repetitions par image)...")
    mesures = executer_lot(
        images=images,
        nb_repetitions=config["nb_repetitions"],
        force_destination=config["mode_routage"],
        delai_entre_requetes_ms=config["delai_entre_requetes_ms"],
    )

    # Attendre la fin de la sequence
    thread_charge.join(timeout=300)
    generateur.relever()

    # Sauvegarder les resultats bruts
    dossier_resultats = RACINE_PROJET / "experimentations" / "resultats" / "panne"
    csv_brut = dossier_resultats / "resultats-bruts.csv"
    sauvegarder_mesures(mesures, csv_brut)

    # Analyser et generer les rapports
    print("\nAnalyse des resultats...")
    stats = analyser_scenario(csv_brut, config["nom"])
    if stats:
        generer_rapport_texte(stats, dossier_resultats / "rapport.txt")
        generer_rapport_json(stats, dossier_resultats / "statistiques.json")

    # Verifier la conformite par rapport aux attendus
    print(f"\n{'=' * 60}")
    print("VERIFICATION DE LA TOLERANCE AUX PANNES")
    print(f"{'=' * 60}")

    if destinations_attendues:
        _verifier_bascule(mesures, destinations_attendues)

    print(f"\nScenario {config['nom']} termine.")
    print(f"Resultats dans : {dossier_resultats}")


def _verifier_bascule(
    mesures: list[Mesure],
    destinations_attendues: dict[int, str],
) -> None:
    """
    Verifie que les destinations observees correspondent aux attendus
    pour chaque phase du scenario.
    """
    # Calculer la duree totale et decouper en phases
    if not mesures:
        print("  Aucune mesure a verifier.")
        return

    timestamps = []
    for m in mesures:
        try:
            from datetime import datetime
            dt = datetime.fromisoformat(m.timestamp.replace("Z", "+00:00"))
            timestamps.append(dt.timestamp())
        except (ValueError, TypeError):
            timestamps.append(0.0)

    debut = min(t for t in timestamps if t > 0)
    fin = max(timestamps)

    # Reconstituer les durees des phases a partir de la config
    # Phases : stable(30s), panne_edge(45s), stable(30s)
    dureses_phases = [30, 45, 30]  # Doit correspondre a configuration.json
    bornes_phases: list[tuple[float, float]] = []
    t_courant = debut
    for duree in dureses_phases:
        bornes_phases.append((t_courant, t_courant + duree))
        t_courant += duree

    resultats: dict[int, dict[str, int]] = {}

    for i, (debut_phase, fin_phase) in enumerate(bornes_phases):
        phase_num = i + 1
        destinations_phase: dict[str, int] = {}

        for m, ts in zip(mesures, timestamps):
            if debut_phase <= ts <= fin_phase:
                dest = m.destination
                destinations_phase[dest] = destinations_phase.get(dest, 0) + 1

        resultats[phase_num] = destinations_phase

    # Afficher les resultats
    for phase_num, attendue in destinations_attendues.items():
        observees = resultats.get(phase_num, {})
        total_phase = sum(observees.values())

        print(f"\n  Phase {phase_num} — destination attendue : {attendue.upper()}")
        print(f"    Observations : {observees}")

        if total_phase == 0:
            print("    Statut : AUCUNE MESURE (phase hors ligne)")
        else:
            pct = observees.get(attendue, 0) / total_phase * 100
            if pct >= 80:
                print(f"    Statut : CONFORME ({pct:.0f}% {attendue})")
            else:
                print(
                    f"    Statut : NON CONFORME "
                    f"({pct:.0f}% {attendue} au lieu de 80%+)"
                )

    print(f"\n{'=' * 60}")


if __name__ == "__main__":
    main()
