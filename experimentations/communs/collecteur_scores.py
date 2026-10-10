"""Score un hold-out via les services d'inference en fonctionnement.

Le script appelle **directement** les services d'inference (ports 8001, 8002,
8011, 8012) et jamais le moteur de decision. Cette distinction n'est pas
cosmetique : passer par le moteur ecrirait une ligne par image dans la table
`diagnostics` et fausserait les compteurs de `/historique` et `/monitoring`,
c'est-a-dire l'etat que l'on est en train d'etudier.

Recuperer la probabilite de la pathologie ne depend pas de la convention
interne du modele. La reponse porte la classe predite et la confiance de
*cette* classe, donc :

    P(pathologie) = confiance          si la prediction est "positif"
    P(pathologie) = 1 - confiance      si la prediction est "negatif"

C'est ce qui evite d'appliquer a l'envers la table `ORIENTATIONS` de
`calibrage.py` lors de la collecte. Cette table reste la reference pour le
code de production ; elle est verifiee par `test_calibrage.py`.

Usage :

    python experimentations/communs/collecteur_scores.py \\
        --manifeste experimentations/manifestes/pneumonie_mooney_test.csv \\
        --pool /tmp/opencode/mooney/chest_xray/test \\
        --sortie experimentations/resultats/calibrage/pneumonie_scores.csv \\
        --services edge=http://localhost:8012 cloud=http://localhost:8002
"""

from __future__ import annotations

import argparse
import csv
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

RACINE_PROJET = Path(__file__).resolve().parents[2]
if str(RACINE_PROJET) not in sys.path:
    sys.path.insert(0, str(RACINE_PROJET))

from experimentations.communs.manifeste import lire_manifeste  # noqa: E402

CHEMINS = (
    "chemin_relatif",
    "etiquette",
    "mode",
    "prediction",
    "confiance_brute",
    "probabilite_pathologie",
    "temps_inference_ms",
    "erreur",
)
DELAI_PAR_IMAGE_S = 120.0
TRAVAILLEURS = 8


def parser_arguments() -> argparse.Namespace:
    analyseur = argparse.ArgumentParser(description=__doc__)
    analyseur.add_argument("--manifeste", type=Path, required=True)
    analyseur.add_argument("--pool", type=Path, required=True)
    analyseur.add_argument("--sortie", type=Path, required=True)
    analyseur.add_argument(
        "--services",
        nargs="+",
        required=True,
        help="paires mode=url, par exemple edge=http://localhost:8012",
    )
    analyseur.add_argument("--limite", type=int, help="scorer seulement N images")
    return analyseur.parse_args()


def score_image(
    client: httpx.Client, url: str, mode: str, etiquette: int, chemin: Path, relatif: str
) -> dict[str, object]:
    """Score une image et derive la probabilite de la pathologie."""
    ligne: dict[str, object] = {
        "chemin_relatif": relatif,
        "etiquette": etiquette,
        "mode": mode,
        "prediction": "",
        "confiance_brute": "",
        "probabilite_pathologie": "",
        "temps_inference_ms": "",
        "erreur": "",
    }
    try:
        with chemin.open("rb") as flux:
            reponse = client.post(
                f"{url}/diagnostic/analyser",
                files={"fichier": (chemin.name, flux, "image/jpeg")},
                timeout=DELAI_PAR_IMAGE_S,
            )
        reponse.raise_for_status()
        corps = reponse.json()
        confiance = float(corps["confiance"])
        ligne["prediction"] = corps["prediction"]
        ligne["confiance_brute"] = f"{confiance:.4f}"
        ligne["probabilite_pathologie"] = (
            f"{confiance if corps['prediction'] == 'positif' else 1.0 - confiance:.6f}"
        )
        ligne["temps_inference_ms"] = corps.get("temps_inference_ms", "")
    except Exception as erreur:  # noqa: BLE001
        ligne["erreur"] = f"{type(erreur).__name__}: {erreur}"[:200]
    return ligne


def main() -> int:
    arguments = parser_arguments()
    entrees = lire_manifeste(arguments.manifeste)
    if arguments.limite:
        entrees = entrees[: arguments.limite]
    pool = arguments.pool.resolve()

    services = []
    for paire in arguments.services:
        mode, _, url = paire.partition("=")
        if not url:
            raise SystemExit(f"service mal forme : {paire}")
        services.append((mode, url.rstrip("/")))

    print(f"hold-out : {len(entrees)} images x {len(services)} services")
    lignes: list[dict[str, object]] = []
    with httpx.Client() as client:
        for mode, url in services:
            with ThreadPoolExecutor(max_workers=TRAVAILLEURS) as groupe:
                resultats = groupe.map(
                    lambda entree, m=mode, u=url: score_image(
                        client,
                        u,
                        m,
                        entree.etiquette,
                        pool / entree.chemin_relatif,
                        entree.chemin_relatif,
                    ),
                    entrees,
                )
                collectes = list(resultats)
            echecs = sum(1 for ligne in collectes if ligne["erreur"])
            latences = [
                float(ligne["temps_inference_ms"])
                for ligne in collectes
                if ligne["temps_inference_ms"] != ""
            ]
            latences.sort()
            median = latences[len(latences) // 2] if latences else 0.0
            p95 = latences[int(len(latences) * 0.95)] if latences else 0.0
            print(
                f"  {mode:6s} {len(collectes) - echecs}/{len(collectes)} scores, "
                f"latence mediane {median:.1f} ms, P95 {p95:.1f} ms"
                + (f", {echecs} ECHECS" if echecs else "")
            )
            if echecs:
                for ligne in collectes:
                    if ligne["erreur"]:
                        print(f"    ! {ligne['chemin_relatif']} : {ligne['erreur']}")
            lignes.extend(collectes)

    arguments.sortie.parent.mkdir(parents=True, exist_ok=True)
    with arguments.sortie.open("w", encoding="utf-8", newline="") as flux:
        redacteur = csv.DictWriter(flux, fieldnames=CHEMINS, lineterminator="\n")
        redacteur.writeheader()
        redacteur.writerows(lignes)
    print(f"ecrit {len(lignes)} lignes -> {arguments.sortie}")
    return 0 if all(not ligne["erreur"] for ligne in lignes) else 1


if __name__ == "__main__":
    raise SystemExit(main())
