"""Tests du filtre de validation du portail patient (Vague 2).

Decision de produit, tranchee : avec son code OTP, le patient ne lit que le
dernier examen **approuve**. Ce n'est pas un detail technique, c'est une regle
clinique : un examen desapprove ou jamais valide n'est pas un resultat
livrable.

Ces tests verrouillent donc deux proprietes :

1. la requete porte bien le filtre ``v.statut = 'approuve'`` — un examen
   desapprove ne doit jamais ressortir du portail ;
2. un patient dont rien n'a ete approuve recoit une **liste vide**, pas une
   erreur : « rien de valide » est un etat legitime, et un 401 ferait croire a
   une panne.
"""

from __future__ import annotations

import asyncio
import re

import pytest

from app import persistance


class _ResultatFaux:
    def __init__(self, lignes):
        self._lignes = lignes

    def all(self):
        return self._lignes

    def scalar(self):
        return self._lignes[0][0] if self._lignes else None

    def first(self):
        return self._lignes[0] if self._lignes else None


class _SessionEnregistreuse:
    """Capture les requetes SQL et repond selon ce qui est demande.

    Le portail enchaîne deux lectures : le diagnostic retenu, puis ses verdicts.
    Les deux jeux sont distincts, sinon le code lirait la destination du
    diagnostic comme une confiance.
    """

    def __init__(self, lignes, requetes, verdicts=None):
        self._lignes = lignes
        self._requetes = requetes
        self._verdicts = verdicts or []

    async def execute(self, requete, params=None):
        self._requetes.append(str(requete))
        if "resultats_pathologiques" in str(requete):
            return _ResultatFaux(self._verdicts)
        return _ResultatFaux(self._lignes)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False


@pytest.fixture
def session_enregistreuse(monkeypatch: pytest.MonkeyPatch):
    def _installer(lignes, verdicts=None):
        requetes: list[str] = []
        session = _SessionEnregistreuse(lignes, requetes, verdicts)
        monkeypatch.setattr(persistance, "_sessions", lambda: session)
        return requetes

    return _installer


# ---------------------------------------------------------------------------
# Le filtre est dans la requete
# ---------------------------------------------------------------------------


def test_le_portail_filtre_sur_les_examens_approuves(session_enregistreuse):
    """La jointure sur v_etat_validation et la condition « approuve » sont la
    garantie : sans elles, le portail resservirait un compte rendu refuse."""
    requetes = session_enregistreuse([])

    asyncio.run(persistance.obtenir_resultats_par_patient(42))

    selection = requetes[0]
    assert "v_etat_validation" in selection
    assert re.search(r"v\.statut\s*=\s*'approuve'", selection)


def test_aucun_examen_approuve_renvoie_une_liste_vide(session_enregistreuse):
    """Un patient sans aucun examen valide : liste vide, pas d'exception, pas
    de diagnostic fantome."""
    session_enregistreuse([])

    resultats = asyncio.run(persistance.obtenir_resultats_par_patient(42))

    assert resultats == []


def test_le_portail_ne_renvoie_que_le_compte_rendu_approuve(session_enregistreuse):
    """Un diagnostic approuve revient avec son contenu, et la validation
    jointe vaut bien « approuve »."""
    # (id_diagnostic, execute_le, destination, id_examen, nom, code)
    session_enregistreuse(
        [(1042, None, "edge", 44, "IMG.png", "EXA-914730")],
        verdicts=[("tuberculose", "negatif", 0.91, "edge", 812.0)],
    )

    resultats = asyncio.run(persistance.obtenir_resultats_par_patient(42))

    assert len(resultats) == 1
    assert resultats[0]["id_examen"] == 44
    assert resultats[0]["resultats"][0]["pathologie"] == "tuberculose"


def test_sans_base_le_portail_renvoie_une_liste_vide(monkeypatch: pytest.MonkeyPatch):
    """Pas de base : liste vide. Le portail affiche alors son message
    d'indisponibilite, il n'invente aucun resultat."""
    monkeypatch.setattr(persistance, "_sessions", None)

    assert asyncio.run(persistance.obtenir_resultats_par_patient(42)) == []
