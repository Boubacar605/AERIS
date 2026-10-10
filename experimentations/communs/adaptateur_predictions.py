"""Adapter les predictions Kaggle au schema attendu par l'analyseur.

Les notebooks entrainent hors ligne et deposent des CSV de test dont les
colonnes decrivent le modele (`proba_pneumonie`, `proba_tb`, ...). Le
collecteur de scores interroge les services en service et produit le schema
`CHEMINS` de `collecteur_scores.py`, que `analyser_calibrage.py` consomme.

Les deux sources doivent etre comparees par le meme analyseur, donc il faut
un seul format. Ce module fait le pont, sans recalcul : la probabilite
reprise est celle du notebook, jamais une version transformee. La latence
d'inference reste vide, car une mesure de GPU Kaggle n'est pas comparable a
celle du service simule.

La probabilite est reecrite en pleine precision (`%.17g`) et non arrondie. Un
modele bien separe produit des probabilites de l'ordre de 1e-20 pour ses
negatifs : arrondir a six decimales les transformerait en zero, et la
calibration verrait une saturation que le modele ne produit pas.
"""

import argparse
import csv
from pathlib import Path

from .collecteur_scores import CHEMINS

COLONNE_PROBABILITE = {
    "pneumonie": "proba_pneumonie",
    "tuberculose": "proba_tb",
}


def parser_arguments() -> argparse.Namespace:
    analyseur = argparse.ArgumentParser(description=__doc__)
    analyseur.add_argument(
        "--predictions",
        type=Path,
        required=True,
        help="CSV de test produit par un notebook Kaggle",
    )
    analyseur.add_argument(
        "--mode", required=True, help="identifiant du modele, par exemple pn_edge"
    )
    analyseur.add_argument("--pathologie", choices=sorted(COLONNE_PROBABILITE), default="pneumonie")
    analyseur.add_argument("--sortie", type=Path, help="CSV de sortie ; sinon la sortie standard")
    return analyseur.parse_args()


def adapter(predictions: Path, mode: str, pathologie: str) -> list[dict[str, object]]:
    """Reformate les predictions d'un notebook en lignes du schema d'analyse."""
    colonne = COLONNE_PROBABILITE[pathologie]
    lignes = list(csv.DictReader(predictions.open(encoding="utf-8", newline="")))
    if not lignes:
        raise SystemExit(f"{predictions} ne contient aucune ligne")
    if colonne not in lignes[0]:
        raise SystemExit(f"{predictions} n'a pas la colonne {colonne}")

    reformatees: list[dict[str, object]] = []
    for ligne in lignes:
        # les notebooks serialisent les etiquettes en flottants (0.0 / 1.0)
        etiquette = int(float(ligne["etiquette"]))
        proba = float(ligne[colonne])
        reformatees.append(
            {
                "chemin_relatif": ligne["chemin_relatif"],
                "etiquette": etiquette,
                "mode": mode,
                "prediction": "1" if proba >= 0.5 else "0",
                "confiance_brute": f"{proba:.4f}",
                "probabilite_pathologie": format(proba, ".17g"),
                "temps_inference_ms": "",
                "erreur": "",
            }
        )
    return reformatees


def main() -> int:
    arguments = parser_arguments()
    lignes = adapter(arguments.predictions, arguments.mode, arguments.pathologie)
    sortie = arguments.sortie
    if sortie is None:
        import sys

        flux = sys.stdout
        redacteur = csv.DictWriter(flux, fieldnames=CHEMINS, lineterminator="\n")
        redacteur.writeheader()
        redacteur.writerows(lignes)
        return 0

    sortie.parent.mkdir(parents=True, exist_ok=True)
    with sortie.open("w", encoding="utf-8", newline="") as flux:
        redacteur = csv.DictWriter(flux, fieldnames=CHEMINS, lineterminator="\n")
        redacteur.writeheader()
        redacteur.writerows(lignes)
    positifs = sum(int(ligne["etiquette"]) for ligne in lignes)
    print(f"{sortie}: {len(lignes)} lignes, {positifs} positifs, mode={arguments.mode}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
