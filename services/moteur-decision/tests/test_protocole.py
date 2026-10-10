"""Tests des agregats de protocole (Vague 2) : volumetrie de la file.

La page Protocole est un bilan, pas un tableau de bord Edge/Cloud. Elle n'a donc
qu'une seule source de verite — la vue ``v_protocole_validation`` — et trois
pieges meritent un test :

1. ``taux_validation`` vaut **None** quand rien n'a ete approuve. Un 0 % se
   lirait comme un indicateur de performance alors que c'est une absence de
   donnee : c'est la regle « pas de valeur par defaut fictive » ;
2. la base indisponible donne **503**, pas une page a zero, qui ferait croire
   qu'aucun examen n'attend de decision ;
3. les agregats sont reserves au clinicien, comme le reste du geste.

Comme pour ``test_triage.py``, la persistance est simulee : aucune base
PostgreSQL n'est necessaire.
"""

from __future__ import annotations

import pytest
from app import persistance
from fastapi.testclient import TestClient

from tests.test_triage import _ResultatFaux, _SessionFausse

# Les neuf colonnes de v_protocole_validation, dans l'ordre de la vue.
LIGNE = (
    23,  # examens_analyses
    4,  # examens_approuves
    1,  # examens_desapprouves
    2,  # examens_en_attente
    19,  # examens_non_approuves
    7,  # decisions_journalisees
    1,  # otp_revoques
    3,  # controles_a_venir
    3.9,  # delai_moyen_heures
)


@pytest.fixture(autouse=True)
def _base_accesible(monkeypatch: pytest.MonkeyPatch):
    """La base est declaree presente : chaque test branche sa propre vue."""
    monkeypatch.setattr("app.routes.clinique._exiger_base", lambda: None)


def _vue(ligne=LIGNE) -> _SessionFausse:
    """Session qui ne repond qu'a la lecture de la vue de protocole."""

    class _Session(_SessionFausse):
        async def execute(self, requete, params=None):
            return _ResultatFaux([ligne] if "v_protocole_validation" in str(requete) else [])

    return _Session([], [])


@pytest.fixture
def vue_factice(monkeypatch: pytest.MonkeyPatch):
    def _installer(ligne=LIGNE):
        session = _vue(ligne)
        monkeypatch.setattr(persistance, "_sessions", lambda: session)
        return session

    return _installer


def _lire(client: TestClient, token: str):
    return client.get("/protocole", headers={"Authorization": f"Bearer {token}"})


# ---------------------------------------------------------------------------
# Ce que la page doit afficher
# ---------------------------------------------------------------------------


def test_les_agregats_sont_relus_tels_que(vue_factice, client: TestClient, clinicien_token: str):
    """Les compteurs viennent de la vue, sans retraitement ni arrondi."""
    vue_factice()

    reponse = _lire(client, clinicien_token)

    assert reponse.status_code == 200
    corps = reponse.json()
    assert corps["examens_analyses"] == 23
    assert corps["examens_approuves"] == 4
    assert corps["examens_desapprouves"] == 1
    assert corps["examens_non_approuves"] == 19
    assert corps["decisions_journalisees"] == 7
    assert corps["otp_revoques"] == 1
    assert corps["controles_a_venir"] == 3


def test_le_delai_moyen_garde_sa_decimale(vue_factice, client: TestClient, clinicien_token: str):
    """3,9 h doit rester 3,9 h : tronque a 3 h, le rapport de charge ment."""
    vue_factice()

    reponse = _lire(client, clinicien_token)

    assert reponse.json()["delai_moyen_heures"] == 3.9


def test_le_taux_de_validation_est_une_vraie_proportion(
    vue_factice, client: TestClient, clinicien_token: str
):
    """4 approuves sur 23 analyses : 17,4 %, pas 4 et pas 4/23 brut."""
    vue_factice()

    reponse = _lire(client, clinicien_token)

    assert reponse.json()["taux_validation"] == 17.4


def test_aucune_validation_approuvee_donne_un_taux_absent_et_non_zero(
    vue_factice, client: TestClient, clinicien_token: str
):
    """Zeros valides : le taux est ``None``, la page affiche « — ».

    Un 0 % se lirait comme un indicateur catastrophique alors que personne n'a
    encore decide quoi que ce soit.
    """
    vue_factice((23, 0, 0, 0, 23, 0, 0, 0, 0.0))

    reponse = _lire(client, clinicien_token)

    corps = reponse.json()
    assert reponse.status_code == 200
    assert corps["taux_validation"] is None
    assert corps["examens_non_approuves"] == 23


def test_zero_analyse_ne_provoque_pas_de_division_par_zero(
    vue_factice, client: TestClient, clinicien_token: str
):
    """Poste vierge : le taux reste absent, la page ne plante pas."""
    vue_factice((0, 0, 0, 0, 0, 0, 0, 0, 0.0))

    reponse = _lire(client, clinicien_token)

    assert reponse.status_code == 200
    assert reponse.json()["taux_validation"] is None


# ---------------------------------------------------------------------------
# Ce qui ne doit pas etre montre
# ---------------------------------------------------------------------------


def test_une_base_indisponible_renvoie_503_et_non_des_zero(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, clinicien_token: str
):
    """Pas de repli sur des compteurs vides : ils diraient « aucune attente ».

    Ici un chiffre faux serait pire qu'une page d'erreur : un clinicien pourrait
    s'appuyer dessus pour conclure que la file est vide.
    """
    monkeypatch.setattr(persistance, "_sessions", None)

    reponse = _lire(client, clinicien_token)

    assert reponse.status_code == 503
    assert "indisponible" in reponse.json()["detail"].lower()


def test_protocole_est_refuse_sans_token(client: TestClient):
    """Pas d'anonyme : les compteurs de charge sont une donnee de poste."""
    assert client.get("/protocole").status_code == 401


def test_protocole_est_refuse_a_l_admin(client: TestClient, admin_token: str):
    """Pas d'admin : la volumetrie de validation est du ressort du clinicien."""
    reponse = _lire(client, admin_token)

    assert reponse.status_code == 403
