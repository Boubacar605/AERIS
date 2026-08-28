"""Tests unitaires pour la logique de decision Edge vs Cloud."""

from app.logique_routage.selecteur_edge_cloud import _appliquer_regles
from app.schemas.schemas_routage import MetriquesSysteme


def test_reseau_indisponible_force_edge():
    """Si le reseau est coupe, la decision doit etre Edge."""
    metriques = MetriquesSysteme(
        cpu_pourcentage=20.0,
        ram_pourcentage=30.0,
        latence_reseau_ms=9999.0,
        reseau_disponible=False,
    )
    destination, _ = _appliquer_regles(metriques)
    assert destination == "edge"


def test_latence_elevee_force_edge():
    """Si la latence depasse le seuil, la decision doit etre Edge."""
    metriques = MetriquesSysteme(
        cpu_pourcentage=20.0,
        ram_pourcentage=30.0,
        latence_reseau_ms=200.0,
        reseau_disponible=True,
    )
    destination, _ = _appliquer_regles(metriques)
    assert destination == "edge"


def test_cpu_sature_force_cloud():
    """Si le CPU Edge est sature, la decision doit etre Cloud."""
    metriques = MetriquesSysteme(
        cpu_pourcentage=90.0,
        ram_pourcentage=30.0,
        latence_reseau_ms=20.0,
        reseau_disponible=True,
    )
    destination, _ = _appliquer_regles(metriques)
    assert destination == "cloud"


def test_ram_saturee_force_cloud():
    """Si la RAM Edge est saturee, la decision doit etre Cloud."""
    metriques = MetriquesSysteme(
        cpu_pourcentage=20.0,
        ram_pourcentage=90.0,
        latence_reseau_ms=20.0,
        reseau_disponible=True,
    )
    destination, _ = _appliquer_regles(metriques)
    assert destination == "cloud"


def test_conditions_normales_privilegient_edge():
    """En conditions normales, le traitement local (Edge) est privilegie."""
    metriques = MetriquesSysteme(
        cpu_pourcentage=40.0,
        ram_pourcentage=50.0,
        latence_reseau_ms=30.0,
        reseau_disponible=True,
    )
    destination, _ = _appliquer_regles(metriques)
    assert destination == "edge"
