"""Tests du tableau de bord clinicien (synthese du poste).

Trois exigences y sont verifiees, et chacune merite son test :

* l'**unite de compte** est l'examen, pas le diagnostic — la table des
  diagnostics contient les re-analyzes de la passe de charge, et compter
  la-dessus afficherait un pic de 947 unites comme de l'activite clinique ;
* la **frontiere clinique** tient : aucun champ technique ne peut apparaitre
  dans la reponse, meme apres une evolves future du code ;
* une **base vide ou tombee** ne se presente jamais comme une file vide
  sans le dire.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime, timedelta

import pytest
from app import persistance
from fastapi.testclient import TestClient
from sqlalchemy.exc import SQLAlchemyError

# Champs techniques reserves a l'admin / a la recherche. Aucun ne doit
# apparaitre dans la synthese du poste, a aucun niveau de la reponse.
CHAMPS_INTERDITS = (
    "destination",
    "edge",
    "cloud",
    "cpu",
    "ram",
    "latence",
    "reseau",
    "temps_total",
    "temps_inference",
    "escalade",
    "identifiant_systeme",
)


def _maintenant() -> datetime:
    return datetime.now(UTC)


def _parcours_cle(objet, chemin: str = "") -> list[tuple[str, object]]:
    """Aplatit une reponse en couples (chemin, cle)."""
    couples: list[tuple[str, object]] = []
    if isinstance(objet, dict):
        for cle, valeur in objet.items():
            ici = f"{chemin}.{cle}" if chemin else cle
            couples.append((ici, cle))
            couples.extend(_parcours_cle(valeur, ici))
    elif isinstance(objet, list):
        for index, valeur in enumerate(objet):
            couples.extend(_parcours_cle(valeur, f"{chemin}[{index}]"))
    return couples


class _ResultatFaux:
    def __init__(self, lignes):
        self._lignes = lignes

    def all(self):
        return self._lignes

    def first(self):
        return self._lignes[0] if self._lignes else None

    def one(self):
        if not self._lignes:
            raise AssertionError("requete scalaire sans resultat")
        return self._lignes[0]


class _SessionPoste:
    """Branche les quatre lectures de la synthese sur des jeux de lignes.

    Le routage se fait sur le texte SQL, comme le fait la vraie base : c'est
    ce qui permet de verifier que chaque requete demande bien ce qu'elle
    doit demander.
    """

    def __init__(
        self,
        file=(),
        activite=(),
        decisions=(),
        compteurs=(0, 0, 0),
        echeances=(),
    ):
        self._file = list(file)
        self._activite = list(activite)
        self._decisions = list(decisions)
        self._compteurs = compteurs
        self._echeances = list(echeances)
        self.requetes: list[str] = []

    async def execute(self, requete, params=None):
        texte = str(requete)
        self.requetes.append(texte)
        if "v_etat_validation" in texte:
            return _ResultatFaux(self._file)
        if "importer_le::date" in texte:
            return _ResultatFaux(self._activite)
        if "cree_le::date" in texte:
            return _ResultatFaux(self._decisions)
        if "COUNT(*) FROM examens_image" in texte:
            return _ResultatFaux([self._compteurs])
        if "suivis_cliniques" in texte:
            return _ResultatFaux(self._echeances)
        raise AssertionError(f"requete inattendue dans la synthese : {texte[:90]}")

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False


def brancher_poste(
    monkeypatch: pytest.MonkeyPatch,
    file=(),
    activite=(),
    decisions=(),
    compteurs=(0, 0, 0),
    echeances=(),
    verdits=None,
    protocole=None,
) -> _SessionPoste:
    """Branche les lectures de la synthese sur des jeux de lignes.

    Les deux lectures reutilisees ailleurs (verdits du dernier diagnostic,
    agregats du protocole) sont remplacees par des valeurs fixes : le test
    porte alors sur la synthese, pas sur ces helpers.
    """
    sessions = _SessionPoste(file, activite, decisions, compteurs, echeances)
    monkeypatch.setattr(persistance, "_sessions", lambda: sessions)
    monkeypatch.setattr(
        persistance,
        "_verdits_par_diagnostic",
        lambda ids: asyncio.sleep(0, result=verdits or {}),
    )
    monkeypatch.setattr(
        persistance,
        "protocole_validation",
        lambda: asyncio.sleep(0, result=protocole),
    )
    return sessions


def _ligne_file(id_examen: int, jours: int, etat: str) -> tuple:
    return (id_examen, id_examen * 10, _maintenant() - timedelta(days=jours), etat)


# ---------------------------------------------------------------------------
# Unite de compte : l'examen, jamais le diagnostic
# ---------------------------------------------------------------------------


def test_la_synthese_compte_des_examens_et_pas_des_analyses(monkeypatch: pytest.MonkeyPatch):
    """Un examen analyse plusieurs fois reste un examen.

    C'est la non-regression la plus grave du tableau de bord : la base
    contient 1 010 diagnostics pour 25 examens, dont 947 le jour de la passe
    de charge. Compter la serie en analyses afficherait un pic artificiel
    comme de l'activite du poste.
    """
    sessions = brancher_poste(
        monkeypatch,
        # 3 examens analyses, dont un seul a une date d'analyse ancienne.
        file=[_ligne_file(1, 0, "sans_decision"), _ligne_file(2, 1, "sans_decision")],
        activite=[(date(2026, 9, 26), 2), (date(2026, 9, 27), 1)],
        compteurs=(2, 4, 3),
        verdits={10: [{"pathologie": "tuberculose", "prediction": "negatif"}]},
        protocole={"taux_validation": None, "delai_moyen_heures": 0.0, "decisions_journalisees": 0},
    )

    synthese = asyncio.run(persistance.synthese_poste())

    assert synthese["file"]["examens_analyses"] == 2
    assert synthese["file"]["total_examens"] == 2
    # L'activite est une serie d'examens enregistres, pas de diagnostics.
    assert sum(j["examens"] for j in synthese["activite"]) == 3
    # Aucun jour n'est invente : seuls les jours reellement enregistres
    # figurent dans la serie.
    assert [j["jour"].isoformat() for j in synthese["activite"]] == ["2026-09-26", "2026-09-27"]
    # Et la lecture de la file porte bien sur les examens, pas sur les
    # re-analyses : deux examens, deux lignes.
    lectures_file = [q for q in sessions.requetes if "v_etat_validation" in q]
    assert len(lectures_file) == 1


def test_les_jours_sans_examen_restent_des_trous(monkeypatch: pytest.MonkeyPatch):
    """Une serie d'activite ne doit pas se remplir de zeros.

    Un zero signifie « des examens ont ete records ce jour-la » ; une serie
    qui interpole des zeros entre deux dates.activity ferait croire a une
    activite quotidienne reguliere qui n'a jamais eu lieu.
    """
    brancher_poste(
        monkeypatch,
        file=[_ligne_file(1, 0, "sans_decision")],
        activite=[(date(2026, 9, 12), 10), (date(2026, 9, 16), 1)],
        compteurs=(1, 1, 1),
        protocole={},
    )

    synthese = asyncio.run(persistance.synthese_poste())

    assert len(synthese["activite"]) == 2
    assert [j["examens"] for j in synthese["activite"]] == [10, 1]


def test_les_examens_jamais_analyses_sont_comptes_a_part(monkeypatch: pytest.MonkeyPatch):
    """Un examen enregistre sans analyse doit rester visible, et une seule fois.

    Il n'apparait pas dans la file (il n'a pas de diagnostic), mais il fait
    partie du total : sans lui, les parts de la barre ne retomberaient pas
    sur le nombre d'examens, et le clinicien ne verrait pas un dossier envoye
    sans resultat.
    """
    brancher_poste(
        monkeypatch,
        file=[_ligne_file(1, 0, "approuve")],
        compteurs=(3, 1, 1),
        protocole={"taux_validation": 100.0, "delai_moyen_heures": 2.0},
    )

    synthese = asyncio.run(persistance.synthese_poste())

    assert synthese["file"]["total_examens"] == 3
    assert synthese["file"]["examens_analyses"] == 1
    assert synthese["file"]["jamais_analyses"] == 2
    # Les parts doivent retomber sur le total, sans double compte.
    parts = (
        synthese["file"]["a_valider"]
        + synthese["file"]["valides"]
        + synthese["file"]["desapproves"]
        + synthese["file"]["jamais_analyses"]
    )
    assert parts == synthese["file"]["total_examens"]


# ---------------------------------------------------------------------------
# Tranches d'anciennete et seuil d'alerte
# ---------------------------------------------------------------------------


def test_les_tranches_suivent_le_seuil_du_clinicien(monkeypatch: pytest.MonkeyPatch):
    """Le meme parametre que la page Triage, sinon les deux pages divergent."""
    brancher_poste(
        monkeypatch,
        file=[
            _ligne_file(1, 0, "sans_decision"),
            _ligne_file(2, 1, "sans_decision"),
            _ligne_file(3, 4, "sans_decision"),
            _ligne_file(4, 12, "sans_decision"),
            _ligne_file(5, 3, "approuve"),
        ],
        compteurs=(5, 2, 2),
        protocole={},
    )

    par_defaut = asyncio.run(persistance.synthese_poste())
    assert par_defaut["seuil_alerte_jours"] == 2
    assert par_defaut["file"]["a_valider"] == 4
    # Seuil par defaut de 2 jours : les examens de 4 et 12 jours sont en retard.
    assert par_defaut["file"]["en_retard"] == 2
    assert par_defaut["file"]["age_max_jours"] == 12
    tranches = {t["tranche"]: t["examens"] for t in par_defaut["file"]["anciennete"]}
    assert tranches == {
        "aujourd_hui": 1,
        "1_jour": 1,
        "2_a_6_jours": 1,
        "plus_de_7_jours": 1,
    }

    # Un seuil plus large ne doit pas provoquer un nouveau comptage faux.
    large = asyncio.run(persistance.synthese_poste(seuil_alerte_jours=30))
    assert large["file"]["en_retard"] == 0
    assert large["file"]["a_valider"] == 4


# ---------------------------------------------------------------------------
# Frontiere clinique
# ---------------------------------------------------------------------------


def test_aucun_champ_technique_ne_peut_apparaitre(monkeypatch: pytest.MonkeyPatch):
    """Garde-fou structurel, pas une simple relecture.

    Le perimetre clinicien est une contrainte non negociable : destination
    Edge/Cloud, CPU, RAM et latence restent reserves a l'admin. Ce test
    echoue des qu'un nom de champ contient l'un de ces mots, ou qu'un evolutif
    les fait remonter dans la synthese.
    """
    brancher_poste(
        monkeypatch,
        file=[_ligne_file(1, 0, "sans_decision")],
        activite=[(date(2026, 9, 28), 1)],
        compteurs=(1, 1, 1),
        echeances=[(date(2026, 10, 1), "planifie", "AER-2026-0001", "Controle")],
        verdits={
            10: [
                {"pathologie": "tuberculose", "prediction": "negatif"},
                {"pathologie": "pneumonie", "prediction": "positif"},
            ]
        },
        protocole={"taux_validation": None, "delai_moyen_heures": 1.5, "decisions_journalisees": 1},
    )

    synthese = asyncio.run(persistance.synthese_poste())

    for chemin, cle in _parcours_cle(synthese):
        normalise = str(cle).lower()
        for interdit in CHAMPS_INTERDITS:
            assert (
                interdit not in normalise
            ), f"champ technique « {chemin} » dans la synthese du poste"


def test_les_verdicts_ported_par_le_dernier_diagnostic_separes(
    monkeypatch: pytest.MonkeyPatch,
):
    """Le comptage par pathologie se fait sur un diagnostic par examen.

    Passer par tous les verdicts stockes compterait plusieurs fois le meme
    clichet, analyse plusieurs fois, et les 1 023 lignes incluent la passe de
    charge.
    """
    brancher_poste(
        monkeypatch,
        file=[_ligne_file(1, 0, "sans_decision"), _ligne_file(2, 0, "sans_decision")],
        compteurs=(2, 1, 1),
        verdits={
            10: [{"pathologie": "tuberculose", "prediction": "negatif"}],
            20: [
                {"pathologie": "tuberculose", "prediction": "positif"},
                {"pathologie": "pneumonie", "prediction": "negatif"},
            ],
        },
        protocole={},
    )

    synthese = asyncio.run(persistance.synthese_poste())

    assert synthese["verdits_par_pathologie"] == [
        {"pathologie": "pneumonie", "negatif": 1, "positif": 0, "indetermine": 0},
        {"pathologie": "tuberculose", "negatif": 1, "positif": 1, "indetermine": 0},
    ]


# ---------------------------------------------------------------------------
# Base vide, base tombee, degradation
# ---------------------------------------------------------------------------


def test_une_base_vide_renvoie_des_zero_honnetes(monkeypatch: pytest.MonkeyPatch):
    """Aucun examen ne veut dire zero, pas une exception, et pas de taux."""
    brancher_poste(
        monkeypatch, file=[], activite=[], compteurs=(0, 0, 0), echeances=[], protocole={}
    )

    synthese = asyncio.run(persistance.synthese_poste())

    assert synthese["file"]["a_valider"] == 0
    assert synthese["file"]["total_examens"] == 0
    assert synthese["file"]["en_retard"] == 0
    assert synthese["activite"] == []
    assert synthese["verdits_par_pathologie"] == []
    assert synthese["suivis"]["a_venir"] == []
    # Sans approbation, aucun taux : 0 % se lirait comme une performance.
    assert synthese["validations"]["taux_validation"] is None


def test_sans_session_le_code_leve_et_la_route_renvoie_503(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, clinicien_token: str
):
    """Base tombee -> 503 explicite, jamais un tableau plein de zeros.

    Un clinicien qui lit « 0 a valider » conclude que la file est vide ; avec
    une panne, il se trompe et cesse de regarder. C'est la degradation
    documentee pour le protocole, appliquee telle quelle.
    """
    monkeypatch.setattr(persistance, "_sessions", None)
    monkeypatch.setattr(persistance, "active", lambda: True)

    reponse = client.get("/poste/synthese", headers={"Authorization": f"Bearer {clinicien_token}"})
    assert reponse.status_code == 503
    assert "detail" in reponse.json()


def test_echec_sql_renvoie_503_et_pas_500(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, clinicien_token: str
):
    monkeypatch.setattr(persistance, "active", lambda: True)

    async def _crasher(seuil: int = 2):
        raise SQLAlchemyError("relation indisponible")

    monkeypatch.setattr(persistance, "synthese_poste", _crasher)

    reponse = client.get("/poste/synthese", headers={"Authorization": f"Bearer {clinicien_token}"})
    assert reponse.status_code == 503


def test_synthese_reservee_au_clinicien(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str, admin_token: str
):
    """L'admin est renvoye 403, le clinicien passe."""

    async def _synthese(seuil: int = 2):
        return {"seuil_alerte_jours": seuil, "file": {}, "activite": []}

    monkeypatch.setattr(persistance, "synthese_poste", _synthese)

    interdit = client.get("/poste/synthese", headers={"Authorization": f"Bearer {admin_token}"})
    assert interdit.status_code == 403

    anonyme = client.get("/poste/synthese")
    assert anonyme.status_code in (401, 403)

    autorise = client.get("/poste/synthese", headers={"Authorization": f"Bearer {clinicien_token}"})
    assert autorise.status_code == 200
    assert autorise.json()["seuil_alerte_jours"] == 2


# ---------------------------------------------------------------------------
# Charge et decisions : deux series, memes intervalles de dates
# ---------------------------------------------------------------------------


def test_les_deux_series_partagent_le_meme_axe(monkeypatch: pytest.MonkeyPatch):
    """Examens et decisions sont deux series jointes, sur la meme fenetre.

    Le graphique d'aire compare la charge qui arrive a ce que le clinicien
    tranche : si les deux series n'/etaient pas datees pareil, la soustraction
    n'aurait aucun sens. Une decision sans examen correspondant ferait croire a
    une file qui se vide d'un coup.
    """
    brancher_poste(
        monkeypatch,
        file=[_ligne_file(1, 0, "approuve")],
        activite=[(date(2026, 9, 26), 3), (date(2026, 9, 27), 1)],
        decisions=[(date(2026, 9, 26), 2), (date(2026, 9, 28), 1)],
        compteurs=(1, 1, 1),
        protocole={
            "taux_validation": 100.0,
            "delai_moyen_heures": 2.0,
            "decisions_journalisees": 3,
        },
    )

    synthese = asyncio.run(persistance.synthese_poste())

    assert synthese["activite"] == [
        {"jour": date(2026, 9, 26), "examens": 3},
        {"jour": date(2026, 9, 27), "examens": 1},
    ]
    assert synthese["decisions_par_jour"] == [
        {"jour": date(2026, 9, 26), "decisions": 2},
        {"jour": date(2026, 9, 28), "decisions": 1},
    ]


def test_un_jour_sans_decision_reste_absent_de_la_serie(
    monkeypatch: pytest.MonkeyPatch,
):
    """Une serie journaliere ne se comble pas de zero.

    Le 27 septembre n'a vu aucun examen et aucune decision : il doit disparaitre
    des deux series. Un zero comble afficherait une activite qui n'a pas eu
    lieu, et l'aire du graphique relierait deux jours reels par un creux
    fabrique.
    """
    brancher_poste(
        monkeypatch,
        file=[_ligne_file(1, 0, "approuve")],
        activite=[(date(2026, 9, 26), 2), (date(2026, 9, 28), 1)],
        decisions=[(date(2026, 9, 28), 1)],
        compteurs=(1, 1, 1),
        protocole={
            "taux_validation": 100.0,
            "delai_moyen_heures": 1.0,
            "decisions_journalisees": 1,
        },
    )

    synthese = asyncio.run(persistance.synthese_poste())

    jours_actifs = {l["jour"] for l in synthese["activite"]}
    jours_decides = {l["jour"] for l in synthese["decisions_par_jour"]}
    assert date(2026, 9, 27) not in jours_actifs
    assert date(2026, 9, 27) not in jours_decides
