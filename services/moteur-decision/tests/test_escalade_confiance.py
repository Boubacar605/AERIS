"""Tests du filet de securite de confiance (escalade Edge <-> Cloud).

Couvre le controle qualite post-inference : aucune escalade quand les
confiances sont elevees, escalade automatique des pathologies ambiguës,
arbitrage au plus confiant, et marquage "indetermine" quand aucun avis
n'est fiable.
"""

import asyncio
from unittest.mock import AsyncMock

from app.logique_routage import selecteur_edge_cloud as selecteur
from app.schemas.schemas_routage import ResultatDiagnostic


class _RepondeurInference:
    """Fake `_appeler_service` : retourne les resultats par (source, pathologie)."""

    def __init__(self, table: dict[tuple[str, str], dict]):
        self.table = table
        self.appels: list[tuple[str, str]] = []

    async def __call__(self, client, url, contenu_image, nom_service, source):
        self.appels.append((source, nom_service))
        spec = self.table[(source, nom_service)]
        return ResultatDiagnostic(
            pathologie=nom_service,
            prediction=spec.get("prediction", "negatif"),
            confiance=spec["confiance"],
            temps_inference_ms=spec.get("temps_ms", 1.0),
            source=source,
        )


def _patcher_environnement(
    monkeypatch, cpu: float = 20.0, ram: float = 30.0, reseau_ok: bool = True, latence: float = 30.0
) -> None:
    """Rend l'environnement stable : metriques faibles et reseau nominal."""

    async def _metriques():
        return {"cpu_pourcentage": cpu, "ram_pourcentage": ram}

    monkeypatch.setattr(selecteur, "obtenir_metriques_completes", _metriques)
    monkeypatch.setattr(selecteur, "verifier_connectivite_cloud", AsyncMock(return_value=reseau_ok))
    monkeypatch.setattr(selecteur, "mesurer_latence_cloud", AsyncMock(return_value=latence))


async def _decider_avec(repondeur: _RepondeurInference, monkeypatch, force: str | None = None):
    """Lance decider_destination avec le repondeur injecte."""
    monkeypatch.setattr(selecteur, "_appeler_service", repondeur)
    return await selecteur.decider_destination(b"image", force)


def _lancer_decision(repondeur: _RepondeurInference, monkeypatch, force: str | None = None):
    return asyncio.run(_decider_avec(repondeur, monkeypatch, force))


def test_confiance_haute_sans_escalade(monkeypatch):
    """TB 97% / PN 95% : aucun controle qualite necessaire."""
    _patcher_environnement(monkeypatch)
    repondeur = _RepondeurInference(
        {
            ("edge", "tuberculose"): {"confiance": 0.97},
            ("edge", "pneumonie"): {"confiance": 0.95},
        }
    )
    reponse = _lancer_decision(repondeur, monkeypatch)

    assert reponse.escalades == []
    assert reponse.temps_escalade_ms is None
    assert len(reponse.resultats) == 2
    for resultat in reponse.resultats:
        assert resultat.source == "edge"
        assert resultat.escalade is False
        assert resultat.indetermine is False
    # Aucun appel vers le cloud.
    assert ("cloud", "tuberculose") not in repondeur.appels
    assert ("cloud", "pneumonie") not in repondeur.appels


def test_escalade_tb_ambigu_vers_cloud(monkeypatch):
    """TB Edge 58% (> ambigu) : escalade vers le Cloud qui arbitre a 99%.

    PN Edge 97% n'est pas regiee : le controle qualite est par pathologie.
    """
    _patcher_environnement(monkeypatch)
    repondeur = _RepondeurInference(
        {
            ("edge", "tuberculose"): {"confiance": 0.58},
            ("edge", "pneumonie"): {"confiance": 0.97},
            ("cloud", "tuberculose"): {"confiance": 0.99},
        }
    )
    reponse = _lancer_decision(repondeur, monkeypatch)

    # La pathologie tuberculose a ete escaladee puis arbitree vers le cloud.
    tb = next(r for r in reponse.resultats if r.pathologie == "tuberculose")
    assert tb.source == "cloud"
    assert tb.escalade is True
    assert tb.confiance == 0.99
    assert tb.confiance_initiale == 0.58
    assert tb.source_initiale == "edge"
    assert tb.indetermine is False

    # La pneumonie, deja fiable, reste sur l'edge sans escalade.
    pn = next(r for r in reponse.resultats if r.pathologie == "pneumonie")
    assert pn.source == "edge"
    assert pn.escalade is False
    assert pn.confiance == 0.97

    # L'evenement est trace avec la decision d'arbitrage.
    assert len(reponse.escalades) == 1
    evenement = reponse.escalades[0]
    assert evenement.pathologie == "tuberculose"
    assert evenement.source_initiale == "edge"
    assert evenement.source_controle == "cloud"
    assert evenement.confiance_initiale == 0.58
    assert evenement.confiance_controle == 0.99
    assert evenement.decision == "arbitrage_a_prevalu"
    assert reponse.temps_escalade_ms is not None


def test_escalade_impossible_reseau_indisponible(monkeypatch):
    """Reseau coupe : aucun appel cloud, le verdict reste local et est
    marque indetermine si la confiance est sous le seuil."""
    _patcher_environnement(monkeypatch, reseau_ok=False)
    repondeur = _RepondeurInference(
        {
            ("edge", "tuberculose"): {"confiance": 0.58},
            ("edge", "pneumonie"): {"confiance": 0.97},
        }
    )
    reponse = _lancer_decision(repondeur, monkeypatch)

    tb = next(r for r in reponse.resultats if r.pathologie == "tuberculose")
    assert tb.source == "edge"
    assert tb.escalade is False
    assert tb.indetermine is True

    assert len(reponse.escalades) == 1
    evenement = reponse.escalades[0]
    assert evenement.decision == "escalade_impossible"
    assert "Reseau indisponible" in evenement.raison

    # Aucun appel cloud ne doit avoir ete tente.
    assert ("cloud", "tuberculose") not in repondeur.appels


def test_deux_pathologies_ambigues_lancent_deux_controles(monkeypatch):
    """TB 50% + PN 55% : les deux controles partent en parallele vers le cloud."""
    _patcher_environnement(monkeypatch)
    repondeur = _RepondeurInference(
        {
            ("edge", "tuberculose"): {"confiance": 0.50},
            ("edge", "pneumonie"): {"confiance": 0.55},
            ("cloud", "tuberculose"): {"confiance": 0.95},
            ("cloud", "pneumonie"): {"confiance": 0.90},
        }
    )
    reponse = _lancer_decision(repondeur, monkeypatch)

    assert ("cloud", "tuberculose") in repondeur.appels
    assert ("cloud", "pneumonie") in repondeur.appels
    assert len(reponse.escalades) == 2
    for resultat in reponse.resultats:
        assert resultat.source == "cloud"
        assert resultat.escalade is True


def test_arbitrage_conserve_initial_quand_controle_inferieur():
    """Un second avis moins bon ne degrade pas le verdict initial."""
    primaire = ResultatDiagnostic(
        pathologie="tuberculose",
        prediction="negatif",
        confiance=0.82,
        source="edge",
    )
    controle = ResultatDiagnostic(
        pathologie="tuberculose",
        prediction="negatif",
        confiance=0.80,
        source="cloud",
    )
    final, evenement = selecteur._arbitrer_resultats(primaire, controle, seuil_indetermine=0.60)

    assert final.source == "edge"
    assert final.confiance == 0.82
    assert final.escalade is True
    assert final.confiance_initiale == 0.82
    assert final.indetermine is False
    assert evenement.decision == "arbitrage_conserve_initial"


def test_cloud_ambigu_apres_escalade_marque_indetermine():
    """Ni l'Edge ni le Cloud ne sont fiables : le verdict est marque
    indetermine, jamais un verdict arbitraire."""
    primaire = ResultatDiagnostic(
        pathologie="tuberculose",
        prediction="negatif",
        confiance=0.55,
        source="edge",
    )
    controle = ResultatDiagnostic(
        pathologie="tuberculose",
        prediction="negatif",
        confiance=0.58,
        source="cloud",
    )
    final, evenement = selecteur._arbitrer_resultats(primaire, controle, seuil_indetermine=0.60)

    # Le plus confiant l'emporte (0.58 > 0.55) mais reste sous le seuil d'usage.
    assert final.source == "cloud"
    assert final.confiance == 0.58
    assert final.indetermine is True
    assert evenement.decision == "arbitrage_a_prevalu"


# ---------------------------------------------------------------------------
# Destination forcée : le verdict doit rester sur la source imposée
# ---------------------------------------------------------------------------


def test_destination_forcee_edge_n_escalade_pas_vers_le_cloud(monkeypatch):
    """force_destination=edge : aucun appel Cloud, le verdict reste local.

    Régression : la destination forcée déclenchait quand même le second avis,
    si bien que le scénario « Tout-Edge » mesurait en réalité le Cloud (les
    confidences remontaient à 1.0, signature du modèle Cloud).
    """
    _patcher_environnement(monkeypatch)
    repondeur = _RepondeurInference(
        {
            ("edge", "tuberculose"): {"confiance": 0.53},
            ("edge", "pneumonie"): {"confiance": 0.97},
            ("cloud", "tuberculose"): {"confiance": 1.0},
        }
    )
    reponse = _lancer_decision(repondeur, monkeypatch, force="edge")

    assert reponse.decision.destination == "edge"
    assert reponse.decision.second_avis is False
    assert reponse.escalades == []
    assert reponse.temps_escalade_ms is None

    # Aucun appel vers le cloud, quelle que soit la pathologie.
    assert ("cloud", "tuberculose") not in repondeur.appels
    assert ("cloud", "pneumonie") not in repondeur.appels

    # Le verdict ambigu reste celui de l'edge, marque pour relecture.
    tb = next(r for r in reponse.resultats if r.pathologie == "tuberculose")
    assert tb.source == "edge"
    assert tb.confiance == 0.53
    assert tb.escalade is False
    assert tb.indetermine is True

    # La pathologie fiable n'est pas touchée.
    pn = next(r for r in reponse.resultats if r.pathologie == "pneumonie")
    assert pn.source == "edge"
    assert pn.indetermine is False


def test_destination_forcee_cloud_n_escalade_pas_vers_edge(monkeypatch):
    """Symétrique : force_destination=cloud reste sur le Cloud."""
    _patcher_environnement(monkeypatch)
    repondeur = _RepondeurInference(
        {
            ("cloud", "tuberculose"): {"confiance": 0.50},
            ("cloud", "pneumonie"): {"confiance": 0.99},
            ("edge", "tuberculose"): {"confiance": 0.95},
        }
    )
    reponse = _lancer_decision(repondeur, monkeypatch, force="cloud")

    assert reponse.decision.destination == "cloud"
    assert reponse.decision.second_avis is False
    assert ("edge", "tuberculose") not in repondeur.appels
    tb = next(r for r in reponse.resultats if r.pathologie == "tuberculose")
    assert tb.source == "cloud"
    assert tb.indetermine is True


def test_second_avis_explicite_restaure_le_controle_qualite_force(monkeypatch):
    """second_avis=true réactive le filet de sécurité malgré la destination forcée."""
    _patcher_environnement(monkeypatch)
    repondeur = _RepondeurInference(
        {
            ("edge", "tuberculose"): {"confiance": 0.53},
            ("edge", "pneumonie"): {"confiance": 0.97},
            ("cloud", "tuberculose"): {"confiance": 0.99},
        }
    )
    monkeypatch.setattr(selecteur, "_appeler_service", repondeur)
    reponse = asyncio.run(selecteur.decider_destination(b"image", "edge", second_avis=True))

    assert reponse.decision.destination == "edge"
    assert reponse.decision.second_avis is True
    assert ("cloud", "tuberculose") in repondeur.appels
    tb = next(r for r in reponse.resultats if r.pathologie == "tuberculose")
    assert tb.source == "cloud"
    assert tb.escalade is True


def test_routage_automatique_conserve_le_second_avis(monkeypatch):
    """Sans destination forcée, le filet de sécurité reste actif par défaut."""
    _patcher_environnement(monkeypatch)
    repondeur = _RepondeurInference(
        {
            ("edge", "tuberculose"): {"confiance": 0.53},
            ("edge", "pneumonie"): {"confiance": 0.97},
            ("cloud", "tuberculose"): {"confiance": 0.99},
        }
    )
    reponse = _lancer_decision(repondeur, monkeypatch)

    assert reponse.decision.second_avis is True
    assert ("cloud", "tuberculose") in repondeur.appels
    assert len(reponse.escalades) == 1
