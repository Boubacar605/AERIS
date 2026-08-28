"""Tests smoke pour verifier que le moteur de decision demarre correctement."""

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


def test_endpoint_routage_accepte_fichier():
    """Verifie que l'endpoint de routage accepte un fichier image."""
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
