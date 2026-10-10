"""Generation et verification des manifestes de split.

Un manifeste est un CSV versionne qui associe, pour chaque image, son lot, son
chemin relatif, son SHA-256 et son etiquette. Il remplace les tirages en
memoire, dont l'ordre d'origine de `os.listdir()` rendait le resultat
irreproductible (cf. `documentation/protocole-split-donnees.md`).

Le module n'utilise que la bibliotheque standard afin de rester importable
depuis un kernel Kaggle, ou aucune dependance supplementaire n'est disponible
sans cout d'installation.
"""

from __future__ import annotations

import csv
import hashlib
import random
from dataclasses import asdict, dataclass
from pathlib import Path

EXTENSIONS_IMAGE = frozenset({".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"})
CHAMPS = ("lot", "chemin_relatif", "sha256", "etiquette")
TAILLE_BLOC = 1 << 20


@dataclass(frozen=True)
class EntreeManifeste:
    """Une ligne de manifeste."""

    lot: str
    chemin_relatif: str
    sha256: str
    etiquette: int


def empreinte_fichier(chemin: Path) -> str:
    """Calcule le SHA-256 d'un fichier par blocs.

    Les radiographies dépassent le Mo ; lire par blocs evite de materialiser
    l'image en memoire.
    """
    contexte = hashlib.sha256()
    with chemin.open("rb") as flux:
        while bloc := flux.read(TAILLE_BLOC):
            contexte.update(bloc)
    return contexte.hexdigest()


def lister_images(racine: Path) -> list[Path]:
    """Liste les images sous une racine, triees lexicographiquement.

    Le tri est l'invariant central du protocole : c'est lui qui rend le split
    independant de l'ordre de parcours du systeme de fichiers, seule cause de
    la perte de la repartition historique de la tuberculose.
    """
    racine = Path(racine)
    trouves = [
        chemin
        for chemin in racine.rglob("*")
        if chemin.is_file() and chemin.suffix.lower() in EXTENSIONS_IMAGE
    ]
    return sorted(trouves, key=lambda chemin: chemin.relative_to(racine).as_posix())


def repartir(chemins: list[str], ratios: dict[str, float], graine: int) -> dict[str, list[str]]:
    """Repartit une liste de chemins en lots, de facon deterministe.

    L'ordre d'echantillonnage suit le protocole : entrainement d'abord, puis
    test parmi le complement, puis validation parmi le test restant. Ainsi
    chaque lot est inclus dans un autre par construction, jamais par une
    condition ecrite a un autre endroit.

    Parametres :
        chemins : liste de chemins relatifs, **deja triee**.
        ratios : proportion par lot, dont la somme vaut 1 a 1e-9 pres.
        graine : graine du generateur, ecrite dans le manifeste.

    Retours :
        Chemins rattaches a chaque nom de lot.
    """
    if abs(sum(ratios.values()) - 1.0) > 1e-9:
        raise ValueError(f"la somme des ratios vaut {sum(ratios.values())}, attendu 1")
    noms = list(ratios)
    if len(noms) < 2:
        raise ValueError("un split exige au moins deux lots")

    generateur = random.Random(graine)
    restants = list(chemins)
    attribues: dict[str, list[str]] = {}

    for nom in noms[:-1]:
        effectif = int(len(chemins) * ratios[nom])
        effectif = max(1, min(effectif, len(restants) - 1))
        attribues[nom] = generateur.sample(restants, effectif)
        choisis = set(attribues[nom])
        restants = [chemin for chemin in restants if chemin not in choisis]

    attribues[noms[-1]] = restants
    return attribues


def etiquette_depuis_chemin(chemin_relatif: str) -> int | None:
    """Deduit l'etiquette d'une image a partir de son nom de dossier.

    Accepte les variantes de casse et les separateurs, car chaque pool agrege
    plusieurs collections aux conventions de nommage legerement differentes.
    Le test de positivite se fait sur un composant de chemin entier pour `tb`,
    qui est trop court pour une recherche par sous-chaine.
    """
    morceaux = [morceau.lower() for morceau in chemin_relatif.split("/")]
    positifs = {
        "tb",
        "tuberculose",
        "tuberculosis",
        "pneumonia",
        "pneumonie",
        "malade",
        "sick",
        "abnormal",
    }
    if any(
        "tuberculose" in morceau or "tuberculosis" in morceau or morceau in positifs
        for morceau in morceaux
    ):
        return 1
    if any(morceau in {"normal", "healthy", "negative"} for morceau in morceaux):
        return 0
    return None


def construire(
    racine: Path,
    chemins: list[str],
    lot: str,
    racine_etiquette: Path | None = None,
) -> list[EntreeManifeste]:
    """Construit les lignes de manifeste d'un lot.

    Parametres :
        racine : repertoire de reference, utilise pour lister si ``chemins``
            est vide.
        chemins : chemins relatifs retenus pour ce lot.
        lot : nom du lot.
        racine_etiquette : racine utilisee pour deduire l'etiquette du chemin
            plutot que du contenu. Par defaut, le chemin lui-meme.

    Retours :
        Lignes triees par chemin, donc le manifeste est deterministe.
    """
    if not chemins:
        chemins = [chemin.relative_to(racine).as_posix() for chemin in lister_images(racine)]
    lignes = []
    for relatif in sorted(chemins):
        etiquette = etiquette_depuis_chemin(relatif)
        if etiquette is None:
            raise ValueError(f"etiquette indevinable pour {relatif}")
        lignes.append(
            EntreeManifeste(
                lot=lot,
                chemin_relatif=relatif,
                sha256=empreinte_fichier(racine / relatif),
                etiquette=etiquette,
            )
        )
    return lignes


def ecrire_manifeste(lignes: list[EntreeManifeste], destination: Path) -> None:
    """Ecrit un manifeste CSV, en UTF-8 et avec sauts de ligne explicites."""
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w", encoding="utf-8", newline="") as flux:
        redacteur = csv.DictWriter(flux, fieldnames=CHAMPS, lineterminator="\n")
        redacteur.writeheader()
        for ligne in lignes:
            redacteur.writerow(asdict(ligne))


def lire_manifeste(source: Path) -> list[EntreeManifeste]:
    """Relit un manifeste CSV, en restituant le type de l'etiquette.

    Le CSV ne porte pas de type : sans conversion explicite, une etiquette relue
    serait la chaine ``"1"``, qui ne serait plus egale a l'entier `1` et
    casserait silencieusement toute comparaison d'egalite sur le manifeste.
    """
    with Path(source).open(encoding="utf-8", newline="") as flux:
        return [
            EntreeManifeste(
                lot=ligne["lot"],
                chemin_relatif=ligne["chemin_relatif"],
                sha256=ligne["sha256"],
                etiquette=int(ligne["etiquette"]),
            )
            for ligne in csv.DictReader(flux)
        ]


def verifier(manifestes: dict[str, Path], racine: Path) -> dict[str, object]:
    """Verifie un ensemble de manifestes avant tout entrainement.

    Quatre controles, tous bloquants :

    1. **Empreintes** : chaque fichier existe et correspond a son SHA-256, donc
       le jeu n'a pas derive depuis la generation du manifeste.
    2. **Recouvrement nul** : une image ne peut appartenir a deux lots, sinon le
       test est contamine.
    3. **Etiquettes** : chaque lot contient au moins une image de chaque
       classe, sinon un lot ne peut servir a rien.
    4. **Effectifs** : les totaux concordent avec la taille du pool.

    Retours :
        Rapport utilisationnable comme garde-fou dans un notebook. Leve
        `ValueError` si un controle echoue : mieux vaut un echec bruyant qu'un
        entrainement sur un test contamine.
    """
    racine = Path(racine)
    vues: dict[str, str] = {}
    rapport: dict[str, object] = {"lots": {}, "effectif_total": 0, "empreintes_ok": True}

    for nom, chemin in sorted(manifestes.items()):
        entrees = lire_manifeste(chemin)
        rapport["lots"][nom] = len(entrees)
        rapport["effectif_total"] = int(rapport["effectif_total"]) + len(entrees)
        for entree in entrees:
            fichier = racine / entree.chemin_relatif
            if not fichier.is_file():
                raise ValueError(f"{nom} : fichier absent {entree.chemin_relatif}")
            if empreinte_fichier(fichier) != entree.sha256:
                rapport["empreintes_ok"] = False
                raise ValueError(f"{nom} : empreinte divergente pour {entree.chemin_relatif}")
            deja = vues.get(entree.chemin_relatif)
            if deja is not None:
                raise ValueError(
                    f"{entree.chemin_relatif} figure dans {deja} et {nom} : test contamine"
                )
            vues[entree.chemin_relatif] = nom

        etiquettes = {entree.etiquette for entree in entrees}
        if len(etiquettes) < 2:
            raise ValueError(f"{nom} : une seule classe presente {sorted(etiquettes)}")

    return rapport
