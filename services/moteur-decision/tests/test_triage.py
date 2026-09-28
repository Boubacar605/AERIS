"""Tests de la file de triage (Vague 2) : priorite du poste et alertes.

La file est le point d'entree du clinicien le matin : elle doitpondre a une
seule question, « qu'est-ce qui attend une decision ? ». Trois garanties sont
donc verifiees ici :

1. un examen **approuve** sort de la file, un examen desapprouve y reste avec
   son motif — l'etre humain reclame ;
2. la priorite est decroissante en fonction de l'attente, et l'alerte est
   **derivee** du delai a l'instant de la lecture : aucune ecriture en base
   lors d'une simple consultation ;
3. la file est reservee au clinicien, comme les autres vues du geste.

Comme pour ``test_suivis_validations.py``, la persistance est simulee : aucune
base PostgreSQL n'est necessaire.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import persistance


def _maintenant() -> datetime:
    """Instant de reference, recale sur l'heure reelle.

    Le delai d'attente est calcule par le code avec ``datetime.now()``. Figer
    une date fixe ici rendait les assertions dependantes du jour de
    l'execution : un examen « de la journee » daté du 27/09, teste le 28/09,
    comptait un jour d'attente et déclenchait une alerte. Les dates sont donc
    toujours exprimes relatives a maintenant, qui est ce que dit le test.
    """
    return datetime.now(timezone.utc)


class _ResultatFaux:
    """Resultat SQL minimal : ``all()``/``first()`` et rien d'autre."""

    def __init__(self, lignes):
        self._lignes = lignes

    def all(self):
        return self._lignes

    def first(self):
        return self._lignes[0] if self._lignes else None

    def scalar(self):
        return self._lignes[0][0] if self._lignes else None


class _SessionFausse:
    """Renvoie deux jeux de lignes : les diagnostics, puis la vue validation."""

    def __init__(self, diagnostics: list[tuple], validations: list[tuple]):
        self._diagnostics = diagnostics
        self._validations = validations

    async def execute(self, requete, params=None):
        texte = str(requete)
        if "v_etat_validation" in texte:
            return _ResultatFaux(self._validations)
        if "resultats_pathologiques" in texte:
            return _ResultatFaux([])
        return _ResultatFaux(self._diagnostics)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False


def _ligne_diagnostic(
    id_examen: int,
    jours: int,
    nom: str = "Awa Diop",
    verdict: tuple | None = None,
    telephone: str | None = "22170000000",
) -> tuple:
    return (
        id_examen,
        id_examen + 100,
        _maintenant() - timedelta(days=jours),
        7,
        "AER-2026-0001",
        nom,
        "F",
        1990,
        f"EX-{id_examen:04d}",
        f"IMG-{id_examen}.png",
        telephone,
        f"{nom.lower().replace(' ', '.')}@exemple.sn",
    )


def _verdicts_associes(verdits: dict[int, list[dict]]):
    async def _lecture(ids: list[int]):
        return verdits

    return _lecture


@pytest.fixture
def base_factice(monkeypatch: pytest.MonkeyPatch):
    """Branche une session SQL fausse sur la lecture de la file."""

    def _installer(diagnostics, validations, verdits=None):
        sessions = _SessionFausse(diagnostics, validations)
        monkeypatch.setattr(persistance, "_sessions", lambda: sessions)
        monkeypatch.setattr(
            persistance,
            "_verdits_par_diagnostic",
            _verdicts_associes(verdits or {}),
        )
        return sessions

    return _installer


# ---------------------------------------------------------------------------
# Ce qui entre et ce qui sort de la file
# ---------------------------------------------------------------------------


def test_un_examen_approuve_quitte_la_file(base_factice, monkeypatch: pytest.MonkeyPatch):
    """L'api ne renvoie pas les examens dont la derniere validation est
    « approuve » : ils sont traites, ils n'attendent plus rien."""

    async def _etat(id_examen: int):
        return {"statut": "approuve"}

    base_factice(
        diagnostics=[_ligne_diagnostic(1, 5), _ligne_diagnostic(2, 1)],
        validations=[(1, "approuve")],
    )
    monkeypatch.setattr(persistance, "etat_validation", _etat)

    file = asyncio.run(persistance.lister_file_triage())
    assert [e["id_examen"] for e in file["examens"]] == [2]


def test_un_examen_desapprouve_reste_dans_la_file_avec_son_motif(
    base_factice, monkeypatch: pytest.MonkeyPatch
):
    """Un desaccord ne fait pas sortir l'examen : le clinicien doit pouvoir le
    relire, et le motif s'affiche dans la file."""
    capture: dict = {}

    async def _etat(id_examen: int):
        capture["id_examen"] = id_examen
        return {"statut": "desapprouve", "motif_desaccord": "Image de mauvaise qualite"}

    base_factice(
        diagnostics=[_ligne_diagnostic(4, 2)],
        validations=[(4, "desapprouve")],
    )
    monkeypatch.setattr(persistance, "etat_validation", _etat)

    file = asyncio.run(persistance.lister_file_triage())
    assert len(file["examens"]) == 1
    assert file["examens"][0]["validation"]["statut"] == "desapprouve"
    assert file["examens"][0]["validation"]["motif_desaccord"]


def test_les_analyses_echouees_n_entrent_pas_dans_la_file(
    base_factice, monkeypatch: pytest.MonkeyPatch
):
    """Une analyse echouee n'a aucun verdict a valider : la requete filtre sur
    ``statut = 'completed'`` et rien n'est remonte au poste."""

    async def _etat(id_examen: int):
        return {"statut": "sans_decision"}

    base_factice(diagnostics=[], validations=[])
    monkeypatch.setattr(persistance, "etat_validation", _etat)

    file = asyncio.run(persistance.lister_file_triage())
    assert file["examens"] == []


# ---------------------------------------------------------------------------
# Priorite et alertes
# ---------------------------------------------------------------------------


def test_la_priorite_est_l_examen_le_plus_ancien(base_factice, monkeypatch: pytest.MonkeyPatch):
    """C'est l'ordre inverse du temps d'attente : 15 jours d'attente passe
    avant un examen de la journee."""

    async def _etat(id_examen: int):
        return {"statut": "sans_decision"}

    base_factice(
        diagnostics=[
            _ligne_diagnostic(1, 0),
            _ligne_diagnostic(2, 15),
            _ligne_diagnostic(3, 4),
        ],
        validations=[],
    )
    monkeypatch.setattr(persistance, "etat_validation", _etat)

    file = asyncio.run(persistance.lister_file_triage())
    assert [e["id_examen"] for e in file["examens"]] == [2, 3, 1]


def test_alerte_derivee_du_delai_sans_ecriture(
    base_factice, monkeypatch: pytest.MonkeyPatch
):
    """L'alerte est calculee a la lecture, jamais stockee : changer de seuil
    ne laisse aucune trace en base, et rien n'est ecrit par une consultation."""
    ecritures: list = []

    async def _ecrire(*args, **kwargs):
        ecritures.append(kwargs)

    async def _etat(id_examen: int):
        return {"statut": "sans_decision"}

    base_factice(
        diagnostics=[_ligne_diagnostic(1, 10), _ligne_diagnostic(2, 1)],
        validations=[],
    )
    monkeypatch.setattr(persistance, "etat_validation", _etat)
    monkeypatch.setattr(persistance, "enregistrer_validation", _ecrire)

    file = asyncio.run(persistance.lister_file_triage(2))
    assert [e["id_examen"] for e in file["alertes"]] == [1]
    assert [e["id_examen"] for e in file["examens"] if e["alerte"]] == [1]
    assert ecritures == []

    # Le meme examen, seuil plus large : plus aucune alerte, toujours sans ecriture.
    file = asyncio.run(persistance.lister_file_triage(30))
    assert file["alertes"] == []
    assert ecritures == []


def test_un_examen_de_la_journee_ne_declenche_pas_d_alerte(
    base_factice, monkeypatch: pytest.MonkeyPatch
):
    """Moins de 24 h = 0 jour d'attente : le poste ne doit pas crier au
   beginning de chaque matin pour un examen rendu dans la nuit."""

    async def _etat(id_examen: int):
        return {"statut": "sans_decision"}

    base_factice(
        diagnostics=[_ligne_diagnostic(1, 0)],
        validations=[],
    )
    monkeypatch.setattr(persistance, "etat_validation", _etat)

    file = asyncio.run(persistance.lister_file_triage(2))
    assert file["examens"][0]["jours_attente"] == 0
    assert file["alertes"] == []


# ---------------------------------------------------------------------------
# Degradation et controle d'acces
# ---------------------------------------------------------------------------


def test_sans_base_la_file_est_vide_pas_une_liste_fictive(
    monkeypatch: pytest.MonkeyPatch,
):
    """Ni diagnostic, ni delai, ni alerte : la file vide ne doit pas laisser
    croire qu'il n'y a rien a faire si la base est plutot tombee."""
    monkeypatch.setattr(persistance, "_sessions", None)

    file = asyncio.run(persistance.lister_file_triage())
    assert file == {"seuil_alerte_jours": 2, "examens": [], "alertes": []}


def test_triage_reserve_au_clinicien(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str, admin_token: str
):
    """L'admin est renvoye 403, le clinicien passe : la separation des roles
    tient aussi sur la nouvelle page."""

    async def _file(seuil: int = 2):
        return {"seuil_alerte_jours": seuil, "examens": [], "alertes": []}

    monkeypatch.setattr(persistance, "lister_file_triage", _file)

    forbidden = client.get(
        "/triage", headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert forbidden.status_code == 403

    autorise = client.get(
        "/triage", headers={"Authorization": f"Bearer {clinicien_token}"}
    )
    assert autorise.status_code == 200
    assert autorise.json()["examens"] == []


@pytest.mark.parametrize("seuil", [-1, 61, "beaucoup"])
def test_seuil_d_alerte_hors_bornes(
    client: TestClient, clinicien_token: str, seuil
):
    """Un seuil hors bornes est refuse par le schema, pas interprete."""
    reponse = client.get(
        f"/triage?seuil_alerte_jours={seuil}",
        headers={"Authorization": f"Bearer {clinicien_token}"},
    )
    assert reponse.status_code == 422


def test_sans_token_le_triage_est_refuse(client: TestClient):
    """Aucune exception : la file contient des donnees de patients."""
    assert client.get("/triage").status_code == 401
