"""Genere les manifestes de split a partir d'un pool local.

Les manifestes sont ecrits dans `experimentations/manifestes/` et versionnes
avec le code : ils ne contiennent que des chemins, des empreintes et des
etiquettes, donc aucune donnee radiologique (cf. `.gitignore`).

Usage :

    python experimentations/communs/generer_manifestes.py \\
        --pool /chemin/vers/chest_xray --prefixe pneumonie_mooney \\
        --ratios 0.8 0.1 0.1 --graine 101 --lots entrainement validation test

Pour la pneumonie, la repartition d'origine est conservee : on ne genere que le
manifeste du lot de test, avec `--ratio-test`, afin de **materialiser** un
hold-out deja publie et deja respected par les deux modeles v1.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

RACINE_PROJET = Path(__file__).resolve().parents[2]
if str(RACINE_PROJET) not in sys.path:
    sys.path.insert(0, str(RACINE_PROJET))

from experimentations.communs.manifeste import (  # noqa: E402
    construire,
    ecrire_manifeste,
    lister_images,
    repartir,
    verifier,
)

DOSSIER_MANIFESTES = RACINE_PROJET / "experimentations" / "manifestes"


def analyser_arguments() -> argparse.Namespace:
    analyseur = argparse.ArgumentParser(description=__doc__)
    analyseur.add_argument("--pool", type=Path, required=True, help="racine du pool")
    analyseur.add_argument("--prefixe", required=True, help="prefixe des noms de manifestes")
    analyseur.add_argument(
        "--ratio-test",
        type=float,
        help="si fourni, ne genere que le manifeste de test a cette proportion",
    )
    analyseur.add_argument("--graine", type=int, default=101)
    analyseur.add_argument(
        "--lots",
        nargs="*",
        default=["entrainement", "validation", "test"],
        help="noms des lots, dans l'ordre du tirage",
    )
    analyseur.add_argument("--sortie", type=Path, default=DOSSIER_MANIFESTES)
    return analyseur.parse_args()


def main() -> int:
    arguments = analyser_arguments()
    pool = arguments.pool.resolve()
    if not pool.is_dir():
        raise SystemExit(f"pool introuvable : {pool}")

    chemins = [chemin.relative_to(pool).as_posix() for chemin in lister_images(pool)]
    if not chemins:
        raise SystemExit(f"aucune image sous {pool}")
    print(f"pool : {len(chemins)} images")

    if arguments.ratio_test is not None:
        if not 0.0 < arguments.ratio_test <= 1.0:
            raise SystemExit("--ratio-test doit appartenir a ]0, 1]")
        nom = arguments.lots[-1]
        noms = [nom]
        if arguments.ratio_test == 1.0:
            lots = {nom: list(chemins)}
        else:
            lots = {
                nom: repartir(
                    chemins,
                    {"tirage": arguments.ratio_test, "reste": 1 - arguments.ratio_test},
                    arguments.graine,
                )["tirage"]
            }
    else:
        if len(arguments.lots) < 2:
            raise SystemExit("il faut au moins deux lots")
        parts = [0.8, 0.1, 0.1] if len(arguments.lots) == 3 else None
        if parts is None:
            parts = [1.0 / len(arguments.lots)] * len(arguments.lots)
            parts[0] = 1.0 - sum(parts[1:])
        noms = arguments.lots
        lots = repartir(chemins, dict(zip(noms, parts, strict=True)), arguments.graine)

    manifestes: dict[str, Path] = {}
    for nom in noms:
        destination = arguments.sortie / f"{arguments.prefixe}_{nom}.csv"
        lignes = construire(pool, lots[nom], nom)
        ecrire_manifeste(lignes, destination)
        positifs = sum(ligne.etiquette for ligne in lignes)
        print(f"{nom:14s} {len(lignes):5d} images  positifs={positifs:5d}  -> {destination.name}")
        manifestes[nom] = destination

    rapport = verifier(manifestes, pool)
    print(f"verification OK : {rapport['effectif_total']} images, empreintes conformes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
