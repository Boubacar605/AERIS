"""Tests smoke pour verifier que le moteur de decision demarre correctement."""

from unittest.mock import AsyncMock, patch

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
