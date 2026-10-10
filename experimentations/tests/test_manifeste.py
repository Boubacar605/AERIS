"""Tests du generateur de manifestes.

Le test central est `test_split_independant_de_lordre_de_creation` : il rejoue
exactement la faute qui a rendu la repartition historique de la tuberculose
irreproductible, a savoir une liste de fichiers dont l'ordre d'origine n'est
pas maitrise. Si ce test echoue, le protocole a de nouveau perdu sa garantie
principale.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import pytest

RACINE_PROJET = Path(__file__).resolve().parents[2]
if str(RACINE_PROJET) not in sys.path:
    sys.path.insert(0, str(RACINE_PROJET))

from experimentations.communs.manifeste import (  # noqa: E402
    construire,
    ecrire_manifeste,
    empreinte_fichier,
    etiquette_depuis_chemin,
    lire_manifeste,
    lister_images,
    repartir,
    verifier,
)

TAILE_PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def creer_pool(racine: Path, positifs: int = 40, negatifs: int = 60) -> Path:
    """Ecrit un pool de faux PNG dans une arborescence TB."""
    for index in range(positifs):
        dossier = racine / "Images" / "Tuberculosis"
        dossier.mkdir(parents=True, exist_ok=True)
        (dossier / f"tb_{index:04d}.png").write_bytes(TAILE_PNG + bytes([index % 251]))
    for index in range(negatifs):
        dossier = racine / "Images" / "Normal"
        dossier.mkdir(parents=True, exist_ok=True)
        (dossier / f"n_{index:04d}.png").write_bytes(TAILE_PNG + bytes([index % 249]))
    return racine


class TestEmpreinte:
    def test_hache_alaide_du_contenu(self, tmp_path: Path):
        fichier = tmp_path / "a.bin"
        fichier.write_bytes(b"abc")
        assert empreinte_fichier(fichier) == hashlib.sha256(b"abc").hexdigest()

    def test_hache_par_blocs_les_gros_fichiers(self, tmp_path: Path):
        fichier = tmp_path / "gros.bin"
        contenu = b"x" * (3 * (1 << 20) + 17)
        fichier.write_bytes(contenu)
        assert empreinte_fichier(fichier) == hashlib.sha256(contenu).hexdigest()

    def test_detecte_une_modification_d_un_octet(self, tmp_path: Path):
        fichier = tmp_path / "a.bin"
        fichier.write_bytes(b"abc")
        avant = empreinte_fichier(fichier)
        fichier.write_bytes(b"abd")
        assert empreinte_fichier(fichier) != avant


class TestListage:
    def test_ignore_les_fichiers_non_image(self, tmp_path: Path):
        creer_pool(tmp_path)
        (tmp_path / "notes.txt").write_text("ignore")
        (tmp_path / "Images" / "meta.json").write_text("{}")
        assert len(lister_images(tmp_path)) == 100

    def test_accepte_les_extensions_de_casse_mixed(self, tmp_path: Path):
        (tmp_path / "a.PNG").write_bytes(TAILE_PNG)
        (tmp_path / "b.jpeg").write_bytes(TAILE_PNG)
        (tmp_path / "c.JPG").write_bytes(TAILE_PNG)
        assert len(lister_images(tmp_path)) == 3

    def test_tri_lexicographique(self, tmp_path: Path):
        creer_pool(tmp_path, 5, 5)
        trouves = [chemin.relative_to(tmp_path).as_posix() for chemin in lister_images(tmp_path)]
        assert trouves == sorted(trouves)

    def test_independant_de_lordre_de_creation(self, tmp_path: Path):
        premier, second = tmp_path / "a", tmp_path / "b"
        creer_pool(premier)
        creer_pool(second)
        nommes = sorted(chemin.name for chemin in lister_images(premier))
        for chemin in lister_images(second):
            chemin.unlink()
        for nom in reversed(nommes):
            (second / "Images" / "Tuberculosis").mkdir(parents=True, exist_ok=True)
            (second / "Images" / "Normal").mkdir(parents=True, exist_ok=True)
            (second / nom).write_bytes(TAILE_PNG)
        assert [chemin.name for chemin in lister_images(premier)] == [
            chemin.name for chemin in lister_images(second)
        ]


class TestEtiquette:
    @pytest.mark.parametrize(
        "chemin,attendu",
        [
            ("Images/Tuberculosis/tb1.png", 1),
            ("Images/tuberculosis/tb1.png", 1),
            ("Images/TB/tb1.png", 1),
            ("Images/Normal/n1.png", 0),
            ("Images/normal/n1.png", 0),
            ("Images/Healthy/n1.png", 0),
        ],
    )
    def test_reconnait_les_variantes(self, chemin, attendu):
        assert etiquette_depuis_chemin(chemin) == attendu

    @pytest.mark.parametrize("chemin", ["Images/Autre/x.png", "x.png", "Images/x.png"])
    def test_refuse_un_dossier_inconnu(self, chemin):
        assert etiquette_depuis_chemin(chemin) is None


class TestRepartition:
    def _chemins(self, n: int = 100) -> list[str]:
        return sorted(
            f"Images/{'Tuberculosis' if i % 2 else 'Normal'}/i{i:04d}.png" for i in range(n)
        )

    def test_affecte_toutes_les_images(self):
        chemins = self._chemins()
        lots = repartir(chemins, {"entrainement": 0.8, "test": 0.1, "validation": 0.1}, graine=7)
        assert sorted(c for lot in lots.values() for c in lot) == chemins

    def test_aucun_recouvrement(self):
        chemins = self._chemins()
        lots = repartir(chemins, {"entrainement": 0.8, "test": 0.1, "validation": 0.1}, graine=7)
        totaux = [c for lot in lots.values() for c in lot]
        assert len(totaux) == len(set(totaux))

    def test_respecte_les_ratios(self):
        chemins = self._chemins(200)
        lots = repartir(chemins, {"entrainement": 0.8, "test": 0.1, "validation": 0.1}, graine=7)
        assert len(lots["entrainement"]) == 160
        assert len(lots["test"]) == 20
        assert len(lots["validation"]) == 20

    def test_deterministe_a_graine_fixe(self):
        chemins = self._chemins()
        premier = repartir(chemins, {"entrainement": 0.8, "test": 0.2}, graine=99)
        second = repartir(chemins, {"entrainement": 0.8, "test": 0.2}, graine=99)
        assert premier == second

    def test_change_avec_la_graine(self):
        chemins = self._chemins()
        premier = repartir(chemins, {"entrainement": 0.8, "test": 0.2}, graine=1)
        second = repartir(chemins, {"entrainement": 0.8, "test": 0.2}, graine=2)
        assert premier != second

    def test_refuse_des_ratios_incoherents(self):
        with pytest.raises(ValueError, match="somme des ratios"):
            repartir(self._chemins(), {"entrainement": 0.8, "test": 0.5}, graine=1)

    def test_refuse_un_lot_unique(self):
        with pytest.raises(ValueError, match="au moins deux lots"):
            repartir(self._chemins(), {"seul": 1.0}, graine=1)

    def test_gere_un_pool_tiny_sans_ecraser_de_lot(self):
        chemins = self._chemins(3)
        lots = repartir(chemins, {"entrainement": 0.34, "test": 0.33, "validation": 0.33}, graine=1)
        assert all(len(lot) >= 1 for lot in lots.values())
        assert sorted(c for lot in lots.values() for c in lot) == chemins


class TestManifeste:
    def test_construire_deduit_les_etiquettes(self, tmp_path: Path):
        creer_pool(tmp_path, 4, 6)
        lignes = construire(tmp_path, [], "entrainement")
        assert len(lignes) == 10
        assert sum(ligne.etiquette for ligne in lignes) == 4

    def test_construire_refuse_une_etiquette_inconnue(self, tmp_path: Path):
        (tmp_path / "Images" / "Autre").mkdir(parents=True)
        (tmp_path / "Images" / "Autre" / "x.png").write_bytes(TAILE_PNG)
        with pytest.raises(ValueError, match="etiquette indevinable"):
            construire(tmp_path, [], "entrainement")

    def test_aller_retour_csv(self, tmp_path: Path):
        creer_pool(tmp_path, 4, 6)
        lignes = construire(tmp_path, [], "entrainement")
        destination = tmp_path / "manifeste.csv"
        ecrire_manifeste(lignes, destination)
        relues = lire_manifeste(destination)
        assert relues == lignes

    def test_manifeste_trie_et_stable(self, tmp_path: Path):
        creer_pool(tmp_path, 4, 6)
        assert construire(tmp_path, [], "lot") == construire(tmp_path, [], "lot")

    def test_ecriture_en_utf8_avec_sauts_explicites(self, tmp_path: Path):
        creer_pool(tmp_path, 2, 2)
        destination = tmp_path / "m.csv"
        ecrire_manifeste(construire(tmp_path, [], "lot"), destination)
        contenu = destination.read_bytes()
        assert b"\r\n" not in contenu
        assert contenu.splitlines()[0] == b"lot,chemin_relatif,sha256,etiquette"


class TestVerification:
    def _manifestes(self, tmp_path: Path, graine: int = 7) -> dict[str, Path]:
        creer_pool(tmp_path)
        chemins = [c.relative_to(tmp_path).as_posix() for c in lister_images(tmp_path)]
        lots = repartir(chemins, {"entrainement": 0.8, "test": 0.2}, graine=graine)
        manifestes = {}
        for nom, retenus in lots.items():
            destination = tmp_path / f"{nom}.csv"
            ecrire_manifeste(construire(tmp_path, retenus, nom), destination)
            manifestes[nom] = destination
        return manifestes

    def test_accepte_des_manifestes_sains(self, tmp_path: Path):
        rapport = verifier(self._manifestes(tmp_path), tmp_path)
        assert rapport["effectif_total"] == 100
        assert rapport["empreintes_ok"] is True
        assert rapport["lots"] == {"entrainement": 80, "test": 20}

    def test_detecte_un_recouvrement(self, tmp_path: Path):
        manifestes = self._manifestes(tmp_path)
        ecrire_manifeste(
            lire_manifeste(manifestes["test"])[:5] + lire_manifeste(manifestes["entrainement"])[:5],
            manifestes["test"],
        )
        with pytest.raises(ValueError, match="test contamine"):
            verifier(manifestes, tmp_path)

    def test_detecte_une_derive_de_contenu(self, tmp_path: Path):
        manifestes = self._manifestes(tmp_path)
        cible = tmp_path / lire_manifeste(manifestes["test"])[0].chemin_relatif
        cible.write_bytes(TAILE_PNG + b"modifie")
        with pytest.raises(ValueError, match="empreinte divergente"):
            verifier(manifestes, tmp_path)

    def test_detecte_un_fichier_supprime(self, tmp_path: Path):
        manifestes = self._manifestes(tmp_path)
        (tmp_path / lire_manifeste(manifestes["test"])[0].chemin_relatif).unlink()
        with pytest.raises(ValueError, match="fichier absent"):
            verifier(manifestes, tmp_path)

    def test_refuse_un_lot_a_classe_unique(self, tmp_path: Path):
        creer_pool(tmp_path, 10, 0)
        ecrire_manifeste(construire(tmp_path, [], "lot"), tmp_path / "lot.csv")
        with pytest.raises(ValueError, match="une seule classe"):
            verifier({"lot": tmp_path / "lot.csv"}, tmp_path)
