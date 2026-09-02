"""Tests smoke pour verifier que le service tuberculose demarre correctement."""

from unittest.mock import patch, MagicMock

import numpy as np
import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def mock_modele():
    """Mock le chargement du modele pour les tests sans TensorFlow."""
    modele_factice = MagicMock()
    modele_factice.predict.return_value = np.array([[0.15, 0.85]])
    with patch("app.coeur.inference._modele", modele_factice):
        with patch("app.coeur.inference.charger_modele"):
            yield modele_factice


@pytest.fixture
def client():
    from app.principal import app

    return TestClient(app)


def test_endpoint_sante_repond_ok(client):
    """Verifie que /sante retourne un statut 200 avec statut ok."""
    reponse = client.get("/sante")
    assert reponse.status_code == 200
    donnees = reponse.json()
    assert donnees["statut"] == "ok"
    assert donnees["service"] == "service-tuberculose"


def test_endpoint_racine(client):
    """Verifie que l'endpoint racine retourne les informations du service."""
    reponse = client.get("/")
    assert reponse.status_code == 200
    donnees = reponse.json()
    assert donnees["service"] == "service-tuberculose"
    assert donnees["statut"] == "operationnel"


def test_endpoint_diagnostic_accepte_fichier(client):
    """Verifie que l'endpoint de diagnostic accepte un fichier image."""
    contenu_factice = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
    reponse = client.post(
        "/diagnostic/analyser",
        files={"fichier": ("radiographie.png", contenu_factice, "image/png")},
    )
    assert reponse.status_code == 200
    donnees = reponse.json()
    assert donnees["pathologie"] == "tuberculose"
    assert donnees["prediction"] in ["positif", "negatif"]
    assert 0.0 <= donnees["confiance"] <= 1.0
    assert "temps_inference_ms" in donnees
