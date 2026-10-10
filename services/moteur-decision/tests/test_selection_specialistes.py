"""Tests d'integration du routage selectif des specialistes.

Verifie que ``decider_destination`` ne sollicite que les specialistes
admissibles apres profilage : la pathologie ecartee ne recoit aucun appel
reseau, aucun ResultatDiagnostic, et le filet de securite de confiance
reste actif par pathologie executee.
"""

import asyncio
from unittest.mock import AsyncMock

from app.logique_routage import selecteur_edge_cloud as selecteur
from app.schemas.schemas_routage import ProfilImage, ResultatDiagnostic


class _RepondeurInference:
    """Fake `_appeler_service` : retourne les resultats par (source, pathologie)."""

    def __init__(self, table: dict[tuple[str, str], dict]):
        self.table = table
        self.appels: list[tuple[str, str]] = []

    async def __call__(self, client, url, contenu_image, nom_service, source):
        self.appels.append((source, nom_service))
        spec = self.table.get((source, nom_service), {"confiance": 0.9})
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


def _profil_fabrique(**champs) -> ProfilImage:
    """Profil TB net (PNG carre) construit sans passer par Pillow."""
    return ProfilImage(
        format="PNG",
        largeur_px=300,
        hauteur_px=300,
        ratio_largeur_hauteur=1.0,
        mode_canaux="RGB",
        taille_octets=1024,
        indecodable=False,
        **champs,
    )


async def _decider_avec(
    repondeur: _RepondeurInference,
    monkeypatch,
    contenu: bytes = b"image",
    contexte: str | None = None,
):
    """Lance decider_destination avec repondeur et profilage injectes."""
    monkeypatch.setattr(selecteur, "_appeler_service", repondeur)
    return await selecteur.decider_destination(contenu, contexte=contexte)


def test_profil_tb_ne_sollicite_que_tuberculose(monkeypatch):
    """Cible TB : un seul appel, la pneumonie n'est jamais jointe."""
    _patcher_environnement(monkeypatch)
    monkeypatch.setattr(selecteur, "construire_profil", lambda c, n=None: _profil_fabrique())
    repondeur = _RepondeurInference({})
    reponse = asyncio.run(_decider_avec(repondeur, monkeypatch))

    assert repondeur.appels == [("edge", "tuberculose")]
    assert ("edge", "pneumonie") not in repondeur.appels
    assert len(reponse.resultats) == 1
    assert reponse.resultats[0].pathologie == "tuberculose"
    assert reponse.filtrage is not None
    assert reponse.filtrage.specialiste_ecarte == "pneumonie"
    assert reponse.filtrage.specialistes_admissibles == ["tuberculose"]


def test_filet_escalade_actif_sur_pathologie_executee(monkeypatch):
    """TB seul avec confiance 0.58 -> escalade TB vers cloud ; PN jamais appelee."""
    _patcher_environnement(monkeypatch)
    monkeypatch.setattr(selecteur, "construire_profil", lambda c, n=None: _profil_fabrique())
    repondeur = _RepondeurInference(
        {
            ("edge", "tuberculose"): {"confiance": 0.58},
            ("cloud", "tuberculose"): {"confiance": 0.99},
        }
    )
    reponse = asyncio.run(_decider_avec(repondeur, monkeypatch))

    assert ("cloud", "tuberculose") in repondeur.appels
    assert ("edge", "pneumonie") not in repondeur.appels
    assert ("cloud", "pneumonie") not in repondeur.appels
    assert len(reponse.escalades) == 1
    tb = reponse.resultats[0]
    assert tb.source == "cloud"
    assert tb.escalade is True
    assert tb.confiance == 0.99


def test_contexte_pneumonie_ecarte_tb(monkeypatch):
    """Sur un profil TB fabrique, le contexte clinique PN restreint a PN."""
    _patcher_environnement(monkeypatch)
    monkeypatch.setattr(selecteur, "construire_profil", lambda c, n=None: _profil_fabrique())
    repondeur = _RepondeurInference({})
    reponse = asyncio.run(_decider_avec(repondeur, monkeypatch, contexte="pneumonie"))

    assert repondeur.appels == [("edge", "pneumonie")]
    assert ("edge", "tuberculose") not in repondeur.appels
    assert len(reponse.resultats) == 1
    assert reponse.filtrage is not None
    assert reponse.filtrage.cle_regle == "contexte_pneumonie"


def test_image_indecodable_lance_les_deux(monkeypatch):
    """Repli securitaire : un fichier illisible ne sacrifie aucun verdict."""
    _patcher_environnement(monkeypatch)
    # On utilise le veritable construire_profil : le contenu est du garbage.
    repondeur = _RepondeurInference({})
    reponse = asyncio.run(
        _decider_avec(repondeur, monkeypatch, contenu=b"ceci n'est pas une image")
    )

    assert sorted(repondeur.appels) == [
        ("edge", "pneumonie"),
        ("edge", "tuberculose"),
    ]
    assert {r.pathologie for r in reponse.resultats} == {"tuberculose", "pneumonie"}
    assert reponse.filtrage is not None
    assert reponse.filtrage.cle_regle == "profil_indecodable"
