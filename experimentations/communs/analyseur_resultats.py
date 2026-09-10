"""
Analyseur de resultats pour les scenarios d'experimentation.

Lit les CSV de resultats bruts, calcule les statistiques, genere
les rapports et les graphiques de comparaison.
"""

import csv
import json
import math
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any


# Limite methodologique a documenter dans chaque rapport
NOTE_METHODOLOGIQUE = """
NOTE METHODOLOGIQUE :
Ce jeu de demonstration utilise 10 images par pathologie (20 au total),
issus de jeux de test publics (Shenzhen/Montgomery pour TB,
Chest X-Ray Kaggle pour PN). Les resultats montrent le comportement
architectural du systeme (routage, bascule, latence) mais ne constituent
pas une evaluation clinique de la precision des modeles. Pour une
evaluation publication, un echantillon de 100+ images par classe avec
balance des classes serait necessaire.
"""


@dataclass
class Statistiques:
    """Statistiques agregees pour une metrique donnee."""

    nom: str
    moyenne: float
    mediane: float
    ecart_type: float
    p95: float
    p99: float
    minimum: float
    maximum: float
    nb_echantillons: int


@dataclass
class StatistiquesScenarii:
    """Statistiques completes pour un scenario d'experimentation."""

    nom_scenario: str
    nb_requetes_total: int
    nb_requetesErreur: int
    nb_requetes_edge: int
    nb_requetes_cloud: int
    latence: Statistiques
    inference_tb: Statistiques
    inference_pn: Statistiques
    cpu_edge: Statistiques
    ram_edge: Statistiques
    precision_tb: float | None
    precision_pn: float | None


def lire_csv(chemin_csv: Path) -> list[dict[str, str]]:
    """Lit un fichier CSV et retourne une liste de dictionnaires."""
    with open(chemin_csv, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return list(reader)


def calculer_statistiques(nom: str, valeurs: list[float]) -> Statistiques:
    """
    Calcule les statistiques descriptives pour une liste de valeurs.

    Args:
        nom: Nom de la metrique.
        valeurs: Liste de valeurs numeriques.

    Returns:
        Objet Statistiques avec les calculs effectues.
    """
    if not valeurs:
        return Statistiques(nom, 0, 0, 0, 0, 0, 0, 0, 0)

    n = len(valeurs)
    moyenne = sum(valeurs) / n

    valeurs_triees = sorted(valeurs)
    mediane = _percentile(valeurs_triees, 50)

    variance = sum((x - moyenne) ** 2 for x in valeurs) / max(n - 1, 1)
    ecart_type = math.sqrt(variance)

    p95 = _percentile(valeurs_triees, 95)
    p99 = _percentile(valeurs_triees, 99)

    return Statistiques(
        nom=nom,
        moyenne=round(moyenne, 2),
        mediane=round(mediane, 2),
        ecart_type=round(ecart_type, 2),
        p95=round(p95, 2),
        p99=round(p99, 2),
        minimum=round(min(valeurs), 2),
        maximum=round(max(valeurs), 2),
        nb_echantillons=n,
    )


def _percentile(valeurs_triees: list[float], percentile: float) -> float:
    """Calcule un percentile par interpolation lineaire."""
    if not valeurs_triees:
        return 0.0
    n = len(valeurs_triees)
    k = (percentile / 100) * (n - 1)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return valeurs_triees[int(k)]
    return valeurs_triees[f] * (c - k) + valeurs_triees[c] * (k - f)


def analyser_scenario(
    chemin_csv: Path,
    nom_scenario: str,
) -> StatistiquesScenarii | None:
    """
    Analyse les resultats d'un scenario et calcule les statistiques.

    Args:
        chemin_csv: Chemin vers le CSV de resultats bruts.
        nom_scenario: Nom du scenario analyse.

    Returns:
        StatistiquesScenarii ou None si le fichier est vide.
    """
    lignes = lire_csv(chemin_csv)
    if not lignes:
        print(f"  [AVERTISSEMENT] Fichier vide : {chemin_csv}")
        return None

    # Extraction des valeurs
    latences = []
    temps_tb = []
    temps_pn = []
    cpu_vals = []
    ram_vals = []
    nb_erreurs = 0
    nb_edge = 0
    nb_cloud = 0
    correct_tb = 0
    total_tb = 0
    correct_pn = 0
    total_pn = 0

    for ligne in lignes:
        try:
            latences.append(float(ligne.get("temps_total_ms", 0)))
            cpu_vals.append(float(ligne.get("cpu_edge", 0)))
            ram_vals.append(float(ligne.get("ram_edge", 0)))

            temps_tb_val = float(ligne.get("temps_inference_tb_ms", 0))
            if temps_tb_val > 0:
                temps_tb.append(temps_tb_val)

            temps_pn_val = float(ligne.get("temps_inference_pn_ms", 0))
            if temps_pn_val > 0:
                temps_pn.append(temps_pn_val)

            if ligne.get("est_erreur") == "True":
                nb_erreurs += 1

            dest = ligne.get("destination", "")
            if dest == "edge":
                nb_edge += 1
            elif dest == "cloud":
                nb_cloud += 1

            # Calcul de la precision (si le label est disponible)
            label = ligne.get("label", "")
            pathologie = ligne.get("pathologie", "")

            if pathologie == "tuberculose":
                pred = int(ligne.get("prediction_tb", -1))
                if pred >= 0:
                    total_tb += 1
                    # label "normal" -> prediction 0, label "tuberculose" -> prediction 1
                    label_attendu = 0 if label == "normal" else 1
                    if pred == label_attendu:
                        correct_tb += 1

            elif pathologie == "pneumonie":
                pred = int(ligne.get("prediction_pn", -1))
                if pred >= 0:
                    total_pn += 1
                    label_attendu = 0 if label == "normal" else 1
                    if pred == label_attendu:
                        correct_pn += 1

        except (ValueError, TypeError):
            continue

    precision_tb = (correct_tb / total_tb * 100) if total_tb > 0 else None
    precision_pn = (correct_pn / total_pn * 100) if total_pn > 0 else None

    return StatistiquesScenarii(
        nom_scenario=nom_scenario,
        nb_requetes_total=len(lignes),
        nb_requetesErreur=nb_erreurs,
        nb_requetes_edge=nb_edge,
        nb_requetes_cloud=nb_cloud,
        latence=calculer_statistiques("temps_total_ms", latences),
        inference_tb=calculer_statistiques("temps_inference_tb_ms", temps_tb),
        inference_pn=calculer_statistiques("temps_inference_pn_ms", temps_pn),
        cpu_edge=calculer_statistiques("cpu_edge", cpu_vals),
        ram_edge=calculer_statistiques("ram_edge", ram_vals),
        precision_tb=precision_tb,
        precision_pn=precision_pn,
    )


def generer_rapport_texte(
    stats: StatistiquesScenarii,
    chemin_rapport: Path,
) -> None:
    """
    Genere un rapport texte lisible a partir des statistiques.

    Args:
        stats: Statistiques du scenario.
        chemin_rapport: Chemin du fichier de rapport a creer.
    """
    chemin_rapport.parent.mkdir(parents=True, exist_ok=True)

    lignes = [
        f"{'=' * 60}",
        f"RAPPORT D'EXPERIMENTATION — {stats.nom_scenario.upper()}",
        f"{'=' * 60}",
        "",
        f"Requetes totales : {stats.nb_requetes_total}",
        f"  - Reussies : {stats.nb_requetes_total - stats.nb_requetesErreur}",
        f"  - En erreur : {stats.nb_requetesErreur}",
        f"  - Routees Edge : {stats.nb_requetes_edge}",
        f"  - Routees Cloud : {stats.nb_requetes_cloud}",
        "",
        "--- LATENCE END-TO-END (ms) ---",
        _formater_statistiques(stats.latence),
        "",
        "--- TEMPS D'INFERENCE TUBERCULOSE (ms) ---",
        _formater_statistiques(stats.inference_tb),
        "",
        "--- TEMPS D'INFERENCE PNEUMONIE (ms) ---",
        _formater_statistiques(stats.inference_pn),
        "",
        "--- CPU EDGE (%) ---",
        _formater_statistiques(stats.cpu_edge),
        "",
        "--- RAM EDGE (%) ---",
        _formater_statistiques(stats.ram_edge),
        "",
    ]

    if stats.precision_tb is not None:
        lignes.append(f"--- PRECISION TUBERCULOSE : {stats.precision_tb:.1f}% ---")
    else:
        lignes.append("--- PRECISION TUBERCULOSE : non calculable ---")

    if stats.precision_pn is not None:
        lignes.append(f"--- PRECISION PNEUMONIE : {stats.precision_pn:.1f}% ---")
    else:
        lignes.append("--- PRECISION PNEUMONIE : non calculable ---")

    lignes.extend(["", NOTE_METHODOLOGIQUE])

    with open(chemin_rapport, "w", encoding="utf-8") as f:
        f.write("\n".join(lignes))

    print(f"  Rapport genere : {chemin_rapport}")


def generer_rapport_json(
    stats: StatistiquesScenarii,
    chemin_json: Path,
) -> None:
    """Sauvegarde les statistiques en JSON."""
    chemin_json.parent.mkdir(parents=True, exist_ok=True)

    donnees = {
        "nom_scenario": stats.nom_scenario,
        "nb_requetes_total": stats.nb_requetes_total,
        "nb_requetesErreur": stats.nb_requetesErreur,
        "nb_requetes_edge": stats.nb_requetes_edge,
        "nb_requetes_cloud": stats.nb_requetes_cloud,
        "latence": asdict(stats.latence),
        "inference_tb": asdict(stats.inference_tb),
        "inference_pn": asdict(stats.inference_pn),
        "cpu_edge": asdict(stats.cpu_edge),
        "ram_edge": asdict(stats.ram_edge),
        "precision_tb": stats.precision_tb,
        "precision_pn": stats.precision_pn,
    }

    with open(chemin_json, "w", encoding="utf-8") as f:
        json.dump(donnees, f, indent=2, ensure_ascii=False)

    print(f"  Statistiques JSON : {chemin_json}")


def _formater_statistiques(stats: Statistiques) -> str:
    """Formate un objet Statistiques en texte lisible."""
    if stats.nb_echantillons == 0:
        return "  Aucune donnee disponible."

    return (
        f"  Moyenne  : {stats.moyenne:.2f}\n"
        f"  Mediane  : {stats.mediane:.2f}\n"
        f"  Ecart-type : {stats.ecart_type:.2f}\n"
        f"  P95      : {stats.p95:.2f}\n"
        f"  P99      : {stats.p99:.2f}\n"
        f"  Min      : {stats.minimum:.2f}\n"
        f"  Max      : {stats.maximum:.2f}\n"
        f"  Echantillons : {stats.nb_echantillons}"
    )


def generer_tableau_comparatif(
    scenarios: dict[str, StatistiquesScenarii],
    chemin_csv: Path,
    chemin_rapport: Path,
) -> None:
    """
    Genere un tableau comparatif entre tous les scenarios.

    Args:
        scenarios: Dict {nom_scenario: StatistiquesScenarii}.
        chemin_csv: Chemin de sortie du CSV comparatif.
        chemin_rapport: Chemin du rapport texte comparatif.
    """
    chemin_csv.parent.mkdir(parents=True, exist_ok=True)

    # CSV comparatif
    en_tetes = [
        "scenario", "requete_edge", "requete_cloud", "erreur",
        "latence_moy", "latence_p95",
        "inf_tb_moy", "inf_pn_moy",
        "cpu_moy", "ram_moy",
        "precision_tb", "precision_pn",
    ]

    with open(chemin_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(en_tetes)
        for nom, stats in scenarios.items():
            writer.writerow([
                nom,
                stats.nb_requetes_edge,
                stats.nb_requetes_cloud,
                stats.nb_requetesErreur,
                stats.latence.moyenne,
                stats.latence.p95,
                stats.inference_tb.moyenne,
                stats.inference_pn.moyenne,
                stats.cpu_edge.moyenne,
                stats.ram_edge.moyenne,
                f"{stats.precision_tb:.1f}" if stats.precision_tb is not None else "N/A",
                f"{stats.precision_pn:.1f}" if stats.precision_pn is not None else "N/A",
            ])

    print(f"  Tableau comparatif CSV : {chemin_csv}")

    # Rapport texte comparatif
    lignes = [
        f"{'=' * 70}",
        "TABLEAU COMPARATIF DES SCENARIOS D'EXPERIMENTATION",
        f"{'=' * 70}",
        "",
    ]

    for nom, stats in scenarios.items():
        lignes.extend([
            f"--- {nom.upper()} ---",
            f"  Requetes : {stats.nb_requetes_total} "
            f"(Edge: {stats.nb_requetes_edge}, Cloud: {stats.nb_requetes_cloud})",
            f"  Latence moyenne : {stats.latence.moyenne:.0f} ms "
            f"(P95: {stats.latence.p95:.0f} ms)",
            f"  Inference TB moyenne : {stats.inference_tb.moyenne:.0f} ms",
            f"  Inference PN moyenne : {stats.inference_pn.moyenne:.0f} ms",
            f"  CPU Edge moyen : {stats.cpu_edge.moyenne:.1f}%",
            f"  RAM Edge moyenne : {stats.ram_edge.moyenne:.1f}%",
        ])
        if stats.precision_tb is not None:
            lignes.append(f"  Precision TB : {stats.precision_tb:.1f}%")
        if stats.precision_pn is not None:
            lignes.append(f"  Precision PN : {stats.precision_pn:.1f}%")
        lignes.append("")

    lignes.extend(["", NOTE_METHODOLOGIQUE])

    with open(chemin_rapport, "w", encoding="utf-8") as f:
        f.write("\n".join(lignes))

    print(f"  Rapport comparatif : {chemin_rapport}")
