"""Tests unitaires pour l'evaluateur des ressources Edge (cache et repli)."""

from unittest import mock

import httpx
import pytest

from app.logique_routage import evaluateur_ressources


def _reinitialiser_cache():
    """Remet le cache global dans son etat initial."""
    evaluateur_ressources._cache_metriques = {}
    evaluateur_ressources._cache_timestamp = 0.0


def _mock_echoue_reseau():
    """Fait echouer toute creation de client HTTP (panne reseau simulee)."""
    return mock.patch(
        "app.logique_routage.evaluateur_ressources.httpx.AsyncClient",
        side_effect=httpx.ConnectError("Panne reseau simulee"),
    )


@pytest.mark.asyncio
async def test_repli_securitaire_sans_cache():
    """Sans cache, un echec de collecte force le repli securitaire (99 %)."""
    _reinitialiser_cache()
    with _mock_echoue_reseau():
        metriques = await evaluateur_ressources._interroger_metriques_edge()
    assert metriques == {"cpu_pourcentage": 99.0, "ram_pourcentage": 99.0}


@pytest.mark.asyncio
async def test_cache_recent_utilise_apres_echec_transitoire():
    """Un cache recent est servi pendant une indisponibilite transitoire."""
    _reinitialiser_cache()
    evaluateur_ressources._cache_metriques = {
        "cpu_pourcentage": 12.0,
        "ram_pourcentage": 40.0,
    }
    evaluateur_ressources._cache_timestamp = 1.0
    with mock.patch("time.monotonic", return_value=2.0):
        with _mock_echoue_reseau():
            metriques = await evaluateur_ressources._interroger_metriques_edge()
    assert metriques["cpu_pourcentage"] == 12.0
    assert metriques["ram_pourcentage"] == 40.0


@pytest.mark.asyncio
async def test_cache_perime_fait_basculer_sur_repli():
    """Un cache perime ne doit pas masquer une panne prolongee de l'Edge."""
    _reinitialiser_cache()
    evaluateur_ressources._cache_metriques = {
        "cpu_pourcentage": 12.0,
        "ram_pourcentage": 40.0,
    }
    evaluateur_ressources._cache_timestamp = 1.0
    with mock.patch(
        "time.monotonic",
        return_value=1.0 + evaluateur_ressources.CACHE_DUREE_MAX_S + 1.0,
    ):
        with _mock_echoue_reseau():
            metriques = await evaluateur_ressources._interroger_metriques_edge()
    assert metriques == {"cpu_pourcentage": 99.0, "ram_pourcentage": 99.0}