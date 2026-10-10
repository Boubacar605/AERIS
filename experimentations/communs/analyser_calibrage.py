"""Analyse de calibration d'un hold-out a partir des scores collectes.

Lit le CSV produit par `collecteur_scores.py`, regroupe par mode de
deploiement, puis applique le diagnostic de `calibrage.py` a chaque couche.

Le rapport souligne deux points souvent confondus :

- **l'AUC ne bouge pas** apres recalibrage, par construction (transformation
  monotone). Il ne sert donc qu'a juger la discrimination du modele, pas la
  calibration, et il est rapporte une seule fois.
- **le seuil derive est lui aussi un artefact du choix de l'echelle**. La
  comparaison utile est le point operatoire (rappel, specificite, precision),
  pas la valeur brute du seuil.

Usage :

    python experimentations/communs/analyser_calibrage.py \\
        --scores experimentations/resultats/calibrage/pneumonie_mooney_test_scores.csv \\
        --pathologie pneumonie --rappel 0.90 \\
        --sortie experimentations/resultats/calibrage/pneumonie_rapport.json
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

RACINE_PROJET = Path(__file__).resolve().parents[2]
if str(RACINE_PROJET) not in sys.path:
    sys.path.insert(0, str(RACINE_PROJET))

from experimentations.communs.calibrage import (  # noqa: E402
    evaluer,
    logit,
    metriques_calibration,
)

AUC_TRONQUE = 10**-9


def parser_arguments() -> argparse.Namespace:
    analyseur = argparse.ArgumentParser(description=__doc__)
    analyseur.add_argument("--scores", type=Path, required=True)
    analyseur.add_argument("--pathologie", default="pneumonie")
    analyseur.add_argument("--rappel", type=float, default=0.90)
    analyseur.add_argument("--sortie", type=Path)
    analyseur.add_argument("--n-tirages", type=int, default=1000)
    analyseur.add_argument("--n-tranches", type=int, default=10)
    return analyseur.parse_args()


def aire_sous_courbe(probabilites: np.ndarray, etiquettes: np.ndarray) -> float:
    """Aire sous la courbe ROC, calculee par la formule de Mann-Whitney.

    Les ex-aequo recoivent la moyenne de leurs rangs, sans quoi un modele qui
    renvoie exactement la meme probabilite pour deux images de classes
    differentes serait avantage ou penalise arbitrairement.
    """
    ordres = np.argsort(probabilites, kind="mergesort")
    rangs = np.empty(probabilites.size, dtype=np.float64)
    valeurs = probabilites[ordres]
    i = 0
    while i < valeurs.size:
        j = i
        while j + 1 < valeurs.size and valeurs[j + 1] == valeurs[i]:
            j += 1
        rangs[ordres[i : j + 1]] = (i + j + 2) / 2.0
        i = j + 1
    positifs = etiquettes == 1
    n_pos, n_neg = int(positifs.sum()), int((~positifs).sum())
    if n_pos == 0 or n_neg == 0:
        return float("nan")
    return float((rangs[positifs].sum() - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg))


def saturation(probabilites: np.ndarray, arrondi: int = 4) -> dict[str, float]:
    """Mesure l'effet de l'arrondi de la reponse des services.

    Les services renvoient une confiance arrondie a 4 decimales. Une
    probabilite qui sature a 0 ou 1 est un artefact d'affichage, pas une
    conviction du modele, et elle ne doit pas etre lue comme telle.
    """
    pas = 10.0**-arrondi / 2.0
    return {
        "probabilites_a_zero": float((probabilites <= pas).sum()),
        "probabilites_a_un": float((probabilites >= 1.0 - pas).sum()),
        "probabilites_par_etranglement": float((np.abs(probabilites - arrondi) < pas).sum()),
    }


def main() -> int:
    arguments = parser_arguments()
    lignes = list(csv.DictReader(arguments.scores.open(encoding="utf-8", newline="")))

    par_mode: dict[str, list[dict[str, str]]] = defaultdict(list)
    for ligne in lignes:
        if ligne.get("erreur"):
            continue
        par_mode[ligne["mode"]].append(ligne)

    if not par_mode:
        raise SystemExit("aucun score exploitable")

    rapport: dict[str, object] = {
        "pathologie": arguments.pathologie,
        "rappel_cible": arguments.rappel,
        "source": str(arguments.scores),
        "modes": {},
    }

    for mode, entrees in sorted(par_mode.items()):
        etiquettes = np.array([int(ligne["etiquette"]) for ligne in entrees], dtype=np.float64)
        probabilites = np.array(
            [float(ligne["probabilite_pathologie"]) for ligne in entrees], dtype=np.float64
        )
        latences = sorted(
            float(ligne["temps_inference_ms"]) for ligne in entrees if ligne["temps_inference_ms"]
        )

        z = logit(probabilites)
        evaluation = evaluer(
            z,
            etiquettes,
            rappel_cible=arguments.rappel,
            n_bins=arguments.n_tranches,
            n_tirages_bootstrap=arguments.n_tirages,
        )
        evaluation["auc"] = aire_sous_courbe(probabilites, etiquettes)
        evaluation["saturation"] = saturation(probabilites)
        evaluation["metriques_brutes"] = metriques_calibration(
            probabilites, etiquettes, arguments.n_tranches
        )
        if latences:
            evaluation["latence_ms"] = {
                "mediane": latences[len(latences) // 2],
                "p95": latences[min(int(len(latences) * 0.95), len(latences) - 1)],
                "min": latences[0],
                "max": latences[-1],
            }
        rapport["modes"][mode] = evaluation

        print(f"\n=== {mode} ===")
        print(
            f"  effectif {len(entrees)}  positifs {int(etiquettes.sum())}  "
            f"AUC {evaluation['auc']:.4f}"
        )
        brute = evaluation["avant"]
        corrigee = evaluation["apres"]
        for libelle, mesures in (("brut   ", brute), ("calibre", corrigee)):
            print(
                f"  {libelle}  Brier {mesures['brier']:.5f}  NLL {mesures['nll']:.5f}"
                f"  ECE {mesures['ece']:.5f}"
            )
        if evaluation["temperature"] is None:
            print("  temperature non estimable, aucune correction appliquee")
            if evaluation["diagnostic"] == "temperature_non_estimable":
                print(
                    "  RAPPORT : aucune temperature n'a pu etre estimee ; les colonnes"
                    " brut et calibre sont identiques par construction"
                )
        else:
            print(
                f"  temperature {evaluation['temperature']:.4f}  "
                f"IC95 [{evaluation['acquisition_temperature']['acquisition_inferieure']:.4f}, "
                f"{evaluation['acquisition_temperature']['acquisition_superieure']:.4f}]  "
                f"exclut 1.0 : {evaluation['acquisition_temperature']['exclut_1'] == 1.0}"
            )
        print(
            f"  pente {evaluation['pente_calibration']:.4f}  "
            f"ordonnee {evaluation['ordonnee_calibration']:.4f}"
        )
        print(
            f"  diagnostic : {evaluation['diagnostic']}  " f"-> {evaluation['correction_retenue']}"
        )
        operatoire = evaluation["seuil_calibre"]
        print(
            f"  point operatoire (calibre, rappel {arguments.rappel:.2f}) : "
            f"seuil {operatoire['seuil']:.4f}  rappel {operatoire['rappel']:.4f}  "
            f"precision {operatoire['precision']:.4f}  specificite {operatoire['specificite']:.4f}"
        )
        sat = evaluation["saturation"]
        if sat["probabilites_a_zero"] or sat["probabilites_a_un"]:
            print(
                f"  ARRONDI : {sat['probabilites_a_zero']:.0f} a 0  "
                f"{sat['probabilites_a_un']:.0f} a 1  "
                f"({sat['probabilites_par_etranglement']:.0f} sur la grille d'arrondi)"
            )

    if arguments.sortie:
        arguments.sortie.parent.mkdir(parents=True, exist_ok=True)
        arguments.sortie.write_text(
            json.dumps(rapport, indent=2, ensure_ascii=False, allow_nan=True) + "\n",
            encoding="utf-8",
        )
        print(f"\nrapport ecrit -> {arguments.sortie}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
