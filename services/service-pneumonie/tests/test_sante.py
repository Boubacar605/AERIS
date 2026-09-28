"""Tests smoke pour verifier que le service pneumonie demarre correctement."""

import struct
import zlib
from unittest.mock import patch, MagicMock

import numpy as np
import pytest
from fastapi.testclient import TestClient


def _png_minimal(taille: int = 8) -> bytes:
    """Construit un PNG grayscale valide (zlib + CRC), lisible par PIL."""
    largeur = hauteur = taille
    # Chaque scanline : 1 octet de filtre (0) + 1 octet par pixel.
    brut = b"".join(b"\x00" + b"\x80" * largeur for _ in range(hauteur))

    def morceau(type_marque: bytes, donnees: bytes) -> bytes:
        return (
            struct.pack(">I", len(donnees))
            + type_marque
            + donnees
            + struct.pack(">I", zlib.crc32(type_marque + donnees) & 0xFFFFFFFF)
        )

    entete = struct.pack(">IIBBBBB", largeur, hauteur, 8, 0, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + morceau(b"IHDR", entete)
        + morceau(b"IDAT", zlib.compress(brut))
        + morceau(b"IEND", b"")
    )


import numpy as np
import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def mock_modele():
    """Mock le chargement du modele pour les tests sans TensorFlow."""
    modele_factice = MagicMock()
    modele_factice.predict.return_value = np.array([[0.15]])
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
    assert donnees["service"] == "service-pneumonie"


def test_endpoint_racine(client):
    """Verifie que l'endpoint racine retourne les informations du service."""
    reponse = client.get("/")
    assert reponse.status_code == 200
    donnees = reponse.json()
    assert donnees["service"] == "service-pneumonie"
    assert donnees["statut"] == "operationnel"


def test_endpoint_diagnostic_accepte_fichier(client):
    """Verifie que l'endpoint de diagnostic accepte un fichier image."""
    # Un vrai PNG minimal : l'inference ouvre l'image avec PIL, et un
    # simple en-tete \x89PNG sans corps leve PIL.UnidentifiedImageError.
    contenu_factice = _png_minimal()
    reponse = client.post(
        "/diagnostic/analyser",
        files={"fichier": ("radiographie.png", contenu_factice, "image/png")},
    )
    assert reponse.status_code == 200
    donnees = reponse.json()
    assert donnees["pathologie"] == "pneumonie"
    assert donnees["prediction"] in ["positif", "negatif"]
    assert 0.0 <= donnees["confiance"] <= 1.0
    assert "temps_inference_ms" in donnees


# ---------------------------------------------------------------------------
# Métriques de ressources : lecture du cgroup, pas de l'hôte
# ---------------------------------------------------------------------------

def test_metriques_systeme_expose_la_source_de_mesure(client):
    """La réponse indique si la mesure vient du cgroup ou de l'hôte.

    Régression : la RAM était lue via psutil, donc sur l'hôte (8 Go du
    portable) et jamais sur la limite du conteneur (512 Mo) : la règle de
    saturation RAM du moteur ne pouvait pas se déclencher.
    """
    reponse = client.get("/metriques-systeme")
    assert reponse.status_code == 200
    donnees = reponse.json()

    assert "source" in donnees, "la source de mesure doit être tracée"
    assert "cgroup" in donnees["source"] or "psutil" in donnees["source"]
    assert 0.0 <= donnees["cpu_pourcentage"] <= 100.0
    assert 0.0 <= donnees["ram_pourcentage"] <= 100.0
    assert donnees["ram_totale_mb"] > 0


def test_ram_reflete_la_limite_du_conteneur(client):
    """Sous Docker (`--memory`), la RAM doit être celle du conteneur."""
    donnees = client.get("/metriques-systeme").json()

    if "cgroup" in donnees["source"]:
        assert donnees["ram_utilisee_mb"] <= donnees["ram_totale_mb"]
        # 512 Mo = limite du profil Edge docker-compose.
        assert donnees["ram_totale_mb"] <= 1024, (
            "sous cgroup, la RAM totale doit rester bornée par la limite "
            f"du conteneur, reçu {donnees['ram_totale_mb']} Mo"
        )
