"""Validation de l'adaptateur entre predictions Kaggle et schema d'analyse.

L'adaptateur ne doit rien recalculer : si la probabilite produite par le
notebook etait retransformee, la calibration porterait sur une autre grandeur
que celle mesuree, et le rapport afficherait une confiance qui n'a jamais ete
emise. Ces tests verrouillent donc l'egalite stricte des probabilites et la
conformite au schema consomme par l'analyseur.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

RACINE_PROJET = Path(__file__).resolve().parents[2]
if str(RACINE_PROJET) not in sys.path:
    sys.path.insert(0, str(RACINE_PROJET))

from experimentations.communs.adaptateur_predictions import (  # noqa: E402
    COLONNE_PROBABILITE,
    adapter,
)
from experimentations.communs.collecteur_scores import CHEMINS  # noqa: E402

PREDICTIONS = """chemin_relatif,etiquette,proba_pneumonie,logit_pneumonie
test/NORMAL/IM-0001-0001.jpeg,0.0,0.249713,-1.100021
test/PNEUMONIA/person1_bacteria_jpeg,1.0,0.881204,1.995512
test/PNEUMONIA/person2_bacteria_png,1.0,0.500000,0.000000
"""


@pytest.fixture
def predictions(tmp_path: Path) -> Path:
    chemin = tmp_path / "predictions_test_pn_edge.csv"
    chemin.write_text(PREDICTIONS, encoding="utf-8")
    return chemin


def test_schema_complet(predictions: Path) -> None:
    lignes = adapter(predictions, "pn_edge", "pneumonie")
    assert len(lignes) == 3
    for ligne in lignes:
        assert tuple(ligne) == CHEMINS


def test_probabilite_reprise_sans_transformation(predictions: Path) -> None:
    lignes = adapter(predictions, "pn_edge", "pneumonie")
    assert float(lignes[0]["probabilite_pathologie"]) == pytest.approx(0.249713, abs=5e-7)
    assert float(lignes[1]["probabilite_pathologie"]) == pytest.approx(0.881204, abs=5e-7)


def test_etiquette_floatante_acceptee(predictions: Path) -> None:
    lignes = adapter(predictions, "pn_edge", "pneumonie")
    assert [int(ligne["etiquette"]) for ligne in lignes] == [0, 1, 1]


def test_prediction_derivee_du_seuil_de_convention(predictions: Path) -> None:
    lignes = adapter(predictions, "pn_edge", "pneumonie")
    predictions_calculees = [int(ligne["prediction"]) for ligne in lignes]
    assert predictions_calculees == [0, 1, 1]


def test_latence_vide_car_gpu_kaggle_nest_pas_comparable(predictions: Path) -> None:
    lignes = adapter(predictions, "pn_edge", "pneumonie")
    assert all(ligne["temps_inference_ms"] == "" for ligne in lignes)
    assert all(ligne["erreur"] == "" for ligne in lignes)


def test_colonne_absente_refusee(tmp_path: Path) -> None:
    chemin = tmp_path / "predictions_test_tb.csv"
    chemin.write_text("chemin_relatif,etiquette,proba_tb\nNormal-1.png,0.0,0.1\n", encoding="utf-8")
    with pytest.raises(SystemExit, match="proba_pneumonie"):
        adapter(chemin, "tb_edge", "pneumonie")
    lignes = adapter(chemin, "tb_edge", "tuberculose")
    assert len(lignes) == 1


def test_fichier_vide_refuse(tmp_path: Path) -> None:
    chemin = tmp_path / "vide.csv"
    chemin.write_text("chemin_relatif,etiquette,proba_pneumonie\n", encoding="utf-8")
    with pytest.raises(SystemExit, match="aucune ligne"):
        adapter(chemin, "pn_edge", "pneumonie")


def test_une_colonne_par_pathologie() -> None:
    assert set(COLONNE_PROBABILITE) == {"pneumonie", "tuberculose"}


def test_queue_de_distribution_non_ecrasee(tmp_path: Path) -> None:
    """Une probabilite tres faible doit survivre a l'adaptation.

    Un modele bien separe renvoie 1e-20 sur ses negatifs. Un arrondi a six
    decimales en ferait zero, et la calibration verrait une saturation
    fabriquee : c'est un artefact de l'outil, pas du modele.
    """
    chemin = tmp_path / "predictions_test_tb_edge.csv"
    chemin.write_text(
        "chemin_relatif,etiquette,proba_tb,logit_tb\n"
        "Normal-1.png,0.0,1.5428116e-20,-45.5\n"
        "Normal-2.png,0.0,3.7526934e-18,-42.9\n"
        "Tuberculosis-1.png,1.0,0.9999812,10.9\n",
        encoding="utf-8",
    )
    lignes = adapter(chemin, "tb_edge", "tuberculose")
    assert float(lignes[0]["probabilite_pathologie"]) == pytest.approx(1.5428116e-20, rel=1e-12)
    assert float(lignes[1]["probabilite_pathologie"]) == pytest.approx(3.7526934e-18, rel=1e-12)
    assert float(lignes[0]["probabilite_pathologie"]) > 0.0
