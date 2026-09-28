"""Journal durable de l'historique : la base prime sur la fenetre memoire."""

import pytest
from fastapi.testclient import TestClient

from app import persistance
from app.logique_routage import registre_diagnostics


def test_historique_prend_le_journal_durable_quand_la_base_repond(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    admin_token: str,
):
    """Si PostgreSQL repond, l'historique vient de la base, pas de la RAM."""
    journal = [
        {
            "id": 900,
            "horodatage": "2026-09-20T08:00:00+00:00",
            "destination": "edge",
            "resultats": [],
            "escalades": [],
            "temps_total_ms": 120.0,
            "statut": "completed",
            "contexte": "auto",
        }
    ]
    demande: dict[str, int] = {}

    async def _journal(limite: int):
        demande["limite"] = limite
        return journal

    async def _stats():
        return {
            "total": 983,
            "taux_reussite": 1.0,
            "latence_moyenne_edge_ms": 130.0,
            "latence_moyenne_cloud_ms": 0.0,
            "repartition": {"edge": 983, "cloud": 0},
        }

    monkeypatch.setattr(persistance, "recuperer_diagnostics_recents", _journal)
    monkeypatch.setattr(persistance, "statistiques_durables", _stats)

    reponse = client.get("/historique", headers={"Authorization": f"Bearer {admin_token}"})
    assert reponse.status_code == 200
    corps = reponse.json()
    # La fenetre memoire ne contient pas l'entree 900 : c'est bien la base qui parle.
    assert [e["id"] for e in corps["derniers_diagnostics"]] == [900]
    assert corps["statistiques"]["total"] == 983
    assert demande["limite"] == 200


def test_historique_replie_sur_la_fenetre_memoire_sans_base(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    admin_token: str,
):
    """Base indisponible -> la page reste alimentee par le registre memoire."""
    async def _journal(limite: int):
        return None

    async def _stats():
        return None

    monkeypatch.setattr(persistance, "recuperer_diagnostics_recents", _journal)
    monkeypatch.setattr(persistance, "statistiques_durables", _stats)
    registre_diagnostics.reinitialiser_etat(
        historique=[
            {
                "id": 7,
                "horodatage": "2026-09-20T08:00:00+00:00",
                "destination": "cloud",
                "resultats": [],
                "escalades": [],
                "temps_total_ms": 900.0,
                "statut": "completed",
                "contexte": "auto",
            }
        ],
        compteur=1,
        temps_edge=[],
        temps_cloud=[],
    )

    reponse = client.get("/historique", headers={"Authorization": f"Bearer {admin_token}"})
    assert reponse.status_code == 200
    corps = reponse.json()
    assert [e["id"] for e in corps["derniers_diagnostics"]] == [7]
    assert corps["statistiques"]["total"] == 1


def test_lecture_durable_refusee_sans_base_active():
    """Persistance inacte ou non initialisee -> None, jamais une exception."""
    import asyncio

    assert asyncio.run(persistance.recuperer_diagnostics_recents(10)) is None
    assert asyncio.run(persistance.statistiques_durables()) is None
