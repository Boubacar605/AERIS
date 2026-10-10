"""Tests unitaires pour l'evaluateur reseau (sondes Cloud et retentative)."""

from unittest import mock

import httpx
import pytest
from app.logique_routage import evaluateur_reseau


def _mock_client_reseau(comportements):
    """Mocke httpx.AsyncClient avec une sequence de reponses/erreurs.

    ``comportements`` est une liste d'items : soit une reponse 200, soit
    une exception a propager au premier appel (faux negatif transitoire).
    """
    client = mock.MagicMock()

    async def get(url):
        comportement = comportements.pop(0)
        if isinstance(comportement, Exception):
            raise comportement
        reponse = mock.MagicMock()
        reponse.status_code = comportement
        reponse.request = mock.MagicMock()
        return reponse

    client.get = mock.AsyncMock(side_effect=get)
    client.__aenter__ = mock.AsyncMock(return_value=client)
    client.__aexit__ = mock.AsyncMock(return_value=False)
    return mock.patch(
        "app.logique_routage.evaluateur_reseau.httpx.AsyncClient",
        return_value=client,
    )


@pytest.mark.asyncio
async def test_connectivite_premiere_reponse_suffit():
    """Un seul appel suffit quand le Cloud repond immediatement."""
    with _mock_client_reseau([200]):
        assert await evaluateur_reseau.verifier_connectivite_cloud() is True


@pytest.mark.asyncio
async def test_connectivite_resiste_a_un_faux_negatif_transitoire():
    """Un echec transitoire est absorbe par la retentative."""
    with _mock_client_reseau([httpx.TimeoutException("Churn DNS"), 200]):
        assert await evaluateur_reseau.verifier_connectivite_cloud() is True


@pytest.mark.asyncio
async def test_connectivite_panne_durable_renvoie_faux():
    """Une panne durable doit toujours conclure a l'indisponibilite."""
    with _mock_client_reseau([httpx.ConnectError("Hors ligne"), httpx.ConnectError("Hors ligne")]):
        assert await evaluateur_reseau.verifier_connectivite_cloud() is False


@pytest.mark.asyncio
async def test_latence_premiere_mesure_suffit():
    """Une latence saine est mesuree des le premier appel."""
    with _mock_client_reseau([200]):
        latence = await evaluateur_reseau.mesurer_latence_cloud()
    assert 0.0 <= latence < 100.0


@pytest.mark.asyncio
async def test_latence_resiste_a_un_faux_negatif_transitoire():
    """Un echec transitoire de latence est absorbe par la retentative."""
    with _mock_client_reseau([httpx.TimeoutException("Churn DNS"), 200]):
        latence = await evaluateur_reseau.mesurer_latence_cloud()
    assert 0.0 <= latence < 100.0


@pytest.mark.asyncio
async def test_latence_panne_durable_retourne_repli():
    """Une panne durable de latence doit retourner la valeur de repli."""
    with _mock_client_reseau([httpx.ConnectError("Hors ligne"), httpx.ConnectError("Hors ligne")]):
        assert await evaluateur_reseau.mesurer_latence_cloud() == 9999.0
