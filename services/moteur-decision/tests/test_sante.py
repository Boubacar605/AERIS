"""Tests smoke pour verifier que le moteur de decision demarre correctement."""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.principal import app

client = TestClient(app)


def test_endpoint_sante_repond_ok():
    """Verifie que /sante retourne un statut 200 avec statut ok."""
    reponse = client.get("/sante")
    assert reponse.status_code == 200
    donnees = reponse.json()
    assert donnees["statut"] == "ok"
    assert donnees["service"] == "moteur-decision"


def test_endpoint_racine():
    """Verifie que l'endpoint racine retourne les informations du moteur."""
    reponse = client.get("/")
    assert reponse.status_code == 200
    donnees = reponse.json()
    assert donnees["service"] == "moteur-decision"
    assert "seuils" in donnees


@patch("app.routes.metriques.verifier_connectivite_cloud")
@patch("app.routes.metriques.mesurer_latence_cloud")
@patch("app.routes.metriques.obtenir_metriques_completes")
def test_etat_systeme_inclut_decision_temps_reel(
    mock_metriques, mock_latence, mock_connectivite
):
    """Verifie que /etat-systeme expose la decision temps reelle du moteur."""
    mock_metriques.return_value = {"cpu_pourcentage": 40.0, "ram_pourcentage": 50.0}
    mock_connectivite.return_value = True
    mock_latence.return_value = 30.0

    reponse = client.get("/etat-systeme")
    assert reponse.status_code == 200
    donnees = reponse.json()

    # Decision temps reelle calculee avec les memes regles que le moteur.
    assert donnees["decision"]["destination"] == "edge"
    assert donnees["decision"]["raison"]
    assert donnees["decision"]["metriques"]["reseau_disponible"] is True
    assert donnees["decision"]["metriques"]["latence_reseau_ms"] == 30.0

    # Repartition reelle des requetes (derive de l'historique du registre).
    assert set(donnees["statistiques"]["repartition"]) == {"edge", "cloud"}
    repartition = donnees["statistiques"]["repartition"]
    assert sum(repartition.values()) == donnees["statistiques"]["total"]


@patch("app.logique_routage.selecteur_edge_cloud._appeler_service")
@patch("app.logique_routage.evaluateur_reseau.verifier_connectivite_cloud")
@patch("app.logique_routage.evaluateur_reseau.mesurer_latence_cloud")
@patch("app.logique_routage.evaluateur_ressources.obtenir_utilisation_ram")
@patch("app.logique_routage.evaluateur_ressources.obtenir_utilisation_cpu")
def test_endpoint_routage_accepte_fichier(
    mock_cpu, mock_ram, mock_latence, mock_connectivite, mock_appel
):
    """Verifie que l'endpoint de routage accepte un fichier et retourne un resultat."""
    mock_cpu.return_value = 40.0
    mock_ram.return_value = 50.0
    mock_connectivite.return_value = True
    mock_latence.return_value = 30.0

    from app.schemas.schemas_routage import ResultatDiagnostic

    mock_appel.side_effect = [
        ResultatDiagnostic(
            pathologie="tuberculose", prediction="negatif", confiance=0.92, temps_inference_ms=150.0
        ),
        ResultatDiagnostic(
            pathologie="pneumonie", prediction="negatif", confiance=0.87, temps_inference_ms=120.0
        ),
    ]

    contenu_factice = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
    reponse = client.post(
        "/routage/analyser",
        files={"fichier": ("radiographie.png", contenu_factice, "image/png")},
    )
    assert reponse.status_code == 200
    donnees = reponse.json()
    assert donnees["decision"]["destination"] in ["edge", "cloud"]
    assert len(donnees["resultats"]) == 2
    assert donnees["temps_total_ms"] >= 0