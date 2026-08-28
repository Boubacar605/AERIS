"""Tests smoke pour verifier que le service pneumonie demarre correctement."""

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
    assert donnees["service"] == "service-pneumonie"


def test_endpoint_racine():
    """Verifie que l'endpoint racine retourne les informations du service."""
    reponse = client.get("/")
    assert reponse.status_code == 200
    donnees = reponse.json()
    assert donnees["service"] == "service-pneumonie"
    assert donnees["statut"] == "operationnel"


def test_endpoint_diagnostic_accepte_fichier():
    """Verifie que l'endpoint de diagnostic accepte un fichier image."""
    contenu_factice = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
    reponse = client.post(
        "/diagnostic/analyser",
        files={"fichier": ("radiographie.png", contenu_factice, "image/png")},
    )
    assert reponse.status_code == 200
    donnees = reponse.json()
    assert donnees["pathologie"] == "pneumonie"
    assert donnees["prediction"] in ["positif", "negatif"]
    assert 0.0 <= donnees["confiance"] <= 1.0
