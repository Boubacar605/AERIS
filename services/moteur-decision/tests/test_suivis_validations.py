"""Tests de la Vague 1 clinique : validation tracee, desaccord, suivis.

Trois garanties sont verifiees ici, parce qu'elles sont le sens meme de la
Vague 1 :

1. une decision clinique est **ecrite** (et pas seulement dessinee) ;
2. desaprover un examen **revoque** les codes deja envoyes au patient — sans
   quoi le code permanent laisserait lire le compte rendu refuse ;
3. les vues /patients et /suivis sont reservees au clinicien, l'administrateur
   etant renvoye 403.

Aucune base PostgreSQL n'etant disponible pendant les tests, la couche de
persistance est simulee comme ailleurs (voir ``conftest.py``).
"""

from __future__ import annotations

import asyncio
import types
from datetime import date, datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app import persistance
from app.otp import generer_otp


async def _liste_vide(*args, **kwargs):
    return []


# ---------------------------------------------------------------------------
# POST /admin/examens/desapprouver — le desaccord est obligatoire
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "corps",
    [
        {"id_examen": 7},  # motif absent
        {"id_examen": 7, "motif_desaccord": ""},  # motif vide
        {"motif_desaccord": "Verdicte"},  # id_examen absent
    ],
    ids=["motif_absent", "motif_vide", "examen_absent"],
)
def test_desapprouver_exige_un_motif(client: TestClient, clinicien_token: str, corps: dict):
    """Sans motif, la requete est rejetee par le schema (422) : rien n'est ecrit.

    Le motif n'est pas une formalite : c'est lui qui rend le desaccord
    relisible, et le journal est en ajout — il survit a une reapprobation.
    """
    reponse = client.post(
        "/admin/examens/desapprouver",
        headers={"Authorization": f"Bearer {clinicien_token}"},
        json=corps,
    )
    assert reponse.status_code == 422


def test_desapprouver_trace_le_desaccord_et_revoque_les_otp(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """Le desaccord est journalise ET les codes emis pour l'examen sont revoques."""
    ecrits: list[dict] = []
    revoques: list[int] = []

    async def _patient_de_examen(id_examen: int):
        return 42

    async def _journaliser(**champs):
        ecrits.append(champs)
        return {"id_validation": 3, "id_examen": champs["id_examen"], "statut": "desapprouve"}

    async def _revoquer(id_examen: int):
        revoques.append(id_examen)
        return 2

    monkeypatch.setattr(persistance, "patient_de_examen", _patient_de_examen)
    monkeypatch.setattr(persistance, "enregistrer_validation", _journaliser)
    monkeypatch.setattr(persistance, "revoquer_otp", _revoquer)

    reponse = client.post(
        "/admin/examens/desapprouver",
        headers={"Authorization": f"Bearer {clinicien_token}"},
        json={"id_examen": 7, "motif_desaccord": "Verdict incoherent avec la radio"},
    )
    assert reponse.status_code == 200
    donnees = reponse.json()
    assert donnees["statut"] == "desapprouve"
    assert donnees["otp_revoques"] == 2
    assert revoques == [7]

    assert len(ecrits) == 1
    assert ecrits[0]["statut"] == "desapprouve"
    assert ecrits[0]["motif_desaccord"] == "Verdict incoherent avec la radio"
    assert ecrits[0].get("note_clinique") is None


# ---------------------------------------------------------------------------
# verifier_otp — un code revoque ne donne plus acces au resultat
# ---------------------------------------------------------------------------


def _ligne_otp(revoque_le) -> tuple:
    """Ligne de ``otp_codes`` telle que la lit verifier_otp."""
    return (512, 42, "empreinte", None, 0, None, "221771234567", revoque_le)


class _ResultatOtp:
    def __init__(self, ligne: tuple | None):
        self._ligne = ligne

    def first(self):
        return self._ligne


class _SessionOtpFake:
    def __init__(self, revoque_le):
        self._revoque_le = revoque_le

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    def begin(self):
        return self

    async def __aenter__transaction(self):
        return self

    async def __aexit__transaction(self, *args):
        return False

    async def execute(self, statement, params=None):
        return _ResultatOtp(_ligne_otp(self._revoque_le))

    async def get(self, model, identifiant):
        """Patient destinataire, joignable par le contact de l'OTP."""
        return types.SimpleNamespace(
            id_patient=identifiant,
            telephone="221771234567",
            email="awa.diop@example.org",
        )


def _faux_sessions(revoque_le):
    """``_sessions`` est une fabrique : ``async with _sessions() as session``."""

    def _ouvrir():
        return _SessionOtpFake(revoque_le)

    return _ouvrir


def test_verifier_otp_refuse_un_code_revoque(monkeypatch: pytest.MonkeyPatch):
    """Le point de securite de la Vague 1 : desapprover coupe l'acces.

    Sans ce refus, la desapprobation serait purement cosmetique : le code etant
    permanent et reutilisable, le patient continuerait de lire le compte rendu
    que le clinicien vient de refuser.
    """
    monkeypatch.setattr(persistance, "_sessions", _faux_sessions("2026-09-27 19:00:00+00"))
    code = generer_otp(6)
    assert asyncio.run(persistance.verifier_otp(code, "221771234567")) is None


def test_verifier_otp_accepte_un_code_actif(monkeypatch: pytest.MonkeyPatch):
    """Tant que l'examen n'est pas desapprouve, l'acces permanent reste ouvert."""
    monkeypatch.setattr(persistance, "_sessions", _faux_sessions(None))
    code = generer_otp(6)
    resultat = asyncio.run(persistance.verifier_otp(code, "221771234567"))
    # Le faux renvoie la ligne brute : on verifie surtout l'absence de rejet.
    assert resultat is not None


# ---------------------------------------------------------------------------
# RBAC des vues clinician
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("chemin", ["/patients", "/suivis"])
def test_vues_cliniques_reservees_au_clinicien(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    admin_token: str,
    chemin: str,
):
    """L'administrateur ne consulte ni les dossiers ni les suivis (403)."""
    monkeypatch.setattr(persistance, "lister_dossiers_cliniques", _liste_vide)
    monkeypatch.setattr(persistance, "lister_suivis", _liste_vide)

    reponse = client.get(chemin, headers={"Authorization": f"Bearer {admin_token}"})
    assert reponse.status_code == 403


def test_liste_patients_ouverte_au_clinicien(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """Le clinicien accede a la liste des dossiers, vide ici."""
    monkeypatch.setattr(persistance, "lister_dossiers_cliniques", _liste_vide)

    reponse = client.get("/patients", headers={"Authorization": f"Bearer {clinicien_token}"})
    assert reponse.status_code == 200
    assert reponse.json() == []


def test_chronologie_patient_inconnue_404(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """Un code patient inconnu ne doit pas produire une page vide silencieuse."""

    async def _obtenir(code: str):
        return None

    monkeypatch.setattr(persistance, "obtenir_patient_par_code", _obtenir)

    reponse = client.get(
        "/patients/AER-2026-9999", headers={"Authorization": f"Bearer {clinicien_token}"}
    )
    assert reponse.status_code == 404


def test_chronologie_patient_connue(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """Dossier existant -> chronologie complete, avec le nom du patient."""

    async def _obtenir(code: str):
        return types.SimpleNamespace(id_patient=42, code_patient=code, nom_complet="Awa Diop")

    async def _chronologie(id_patient: int):
        return {
            "code_patient": "AER-2026-0042",
            "nom_complet": "Awa Diop",
            "examens": [],
            "suivis": [],
        }

    monkeypatch.setattr(persistance, "obtenir_patient_par_code", _obtenir)
    monkeypatch.setattr(persistance, "chronologie_patient", _chronologie)

    reponse = client.get(
        "/patients/AER-2026-0042", headers={"Authorization": f"Bearer {clinicien_token}"}
    )
    assert reponse.status_code == 200
    assert reponse.json()["nom_complet"] == "Awa Diop"


# ---------------------------------------------------------------------------
# Suivis
# ---------------------------------------------------------------------------


def test_creer_suivi_patient_inconnu_404(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """On ne programme pas un controle pour un patient inexistant."""

    async def _obtenir(id_patient: int):
        return None

    monkeypatch.setattr(persistance, "obtenir_patient_par_id", _obtenir)

    reponse = client.post(
        "/suivis",
        headers={"Authorization": f"Bearer {clinicien_token}"},
        json={"id_patient": 999, "date_suivi": "2099-10-01", "motif": "Controle"},
    )
    assert reponse.status_code == 404


def test_creer_suivi_examen_origine_inconnu_404(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """L'examen d'origine doit exister, sinon le suivi ne serait pas rattache."""

    async def _obtenir(id_patient: int):
        return types.SimpleNamespace(id_patient=id_patient)

    async def _patient_de_examen(id_examen: int):
        return None

    monkeypatch.setattr(persistance, "obtenir_patient_par_id", _obtenir)
    monkeypatch.setattr(persistance, "patient_de_examen", _patient_de_examen)

    reponse = client.post(
        "/suivis",
        headers={"Authorization": f"Bearer {clinicien_token}"},
        json={
            "id_patient": 42,
            "date_suivi": "2099-10-01",
            "motif": "Controle",
            "id_examen_origine": 999999,
        },
    )
    assert reponse.status_code == 404


def test_creer_suivi_renvoie_le_suivi_cree(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """Suivi valide -> 200 et restitution du suivi cree, examan d'origine relie."""
    capture: dict = {}

    async def _obtenir(id_patient: int):
        return types.SimpleNamespace(id_patient=id_patient)

    async def _patient_de_examen(id_examen: int):
        return 42

    async def _creer(**champs):
        capture.update(champs)
        return {"id_suivi": 11, "statut": "planifie", **champs}

    monkeypatch.setattr(persistance, "obtenir_patient_par_id", _obtenir)
    monkeypatch.setattr(persistance, "patient_de_examen", _patient_de_examen)
    monkeypatch.setattr(persistance, "creer_suivi", _creer)

    reponse = client.post(
        "/suivis",
        headers={"Authorization": f"Bearer {clinicien_token}"},
        json={
            "id_patient": 42,
            "date_suivi": "2099-10-01",
            "motif": "Controle radiologique a 3 mois",
            "id_examen_origine": 7,
        },
    )
    assert reponse.status_code == 200
    assert reponse.json()["id_suivi"] == 11
    assert capture["id_examen_origine"] == 7
    assert capture["motif"] == "Controle radiologique a 3 mois"


def test_changer_statut_suivi_ferme_le_suivi(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """Marquer un suivi realise est le geste le plus frequent du suivi clinique."""
    capture: dict = {}

    async def _changer(id_suivi: int, statut: str):
        capture["id_suivi"] = id_suivi
        capture["statut"] = statut
        return True

    monkeypatch.setattr(persistance, "changer_statut_suivi", _changer)

    reponse = client.patch(
        "/suivis/11",
        headers={"Authorization": f"Bearer {clinicien_token}"},
        json={"statut": "realise"},
    )
    assert reponse.status_code == 200
    assert reponse.json() == {"id_suivi": 11, "statut": "realise"}
    assert capture == {"id_suivi": 11, "statut": "realise"}


def test_changer_statut_suivi_rejette_un_statut_inconnu(
    client: TestClient, clinicien_token: str
):
    """Un statut hors enum est refuse avant d'atteindre la base."""
    reponse = client.patch(
        "/suivis/11",
        headers={"Authorization": f"Bearer {clinicien_token}"},
        json={"statut": "peut_etre"},
    )
    assert reponse.status_code == 422


def test_changer_statut_suivi_inconnu_404(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """Aucun suivi de cet identifiant -> 404, pas de creation fantome."""

    async def _changer(id_suivi: int, statut: str):
        return False

    monkeypatch.setattr(persistance, "changer_statut_suivi", _changer)

    reponse = client.patch(
        "/suivis/999999",
        headers={"Authorization": f"Bearer {clinicien_token}"},
        json={"statut": "realise"},
    )
    assert reponse.status_code == 404


# ---------------------------------------------------------------------------
# Contrat de la reponse de creation (Vague 2)
# ---------------------------------------------------------------------------


class _Transaction:
    """`async with session.begin()` : valide sans rien committer de reel."""

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False


class _SessionEcriture:
    """Fausse session pour le chemin d'ecriture de ``creer_suivi``.

    Les tests d'API doublent ``creer_suivi`` : ils ne verifient donc que la
    route, jamais la forme reellement renvoyee. C'est ce qui a laisse passer
    une reponse reduite a {id_suivi, statut} alors que le compte rendu affiche
    « controle programme le <date> — <motif » juste apres l'enregistrement.
    """

    def __init__(self):
        self.ajoutes: list = []

    def begin(self):
        return _Transaction()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    def begin(self):
        return self

    async def __aenter___transaction(self):  # pragma: no cover - non utilise
        raise AssertionError

    async def __aexit__transaction(self, *args):  # pragma: no cover
        return False

    def add(self, entite):
        # La cle primaire est attribuee par la base : on la simule, sans quoi
        # le retour serait None et le test ne testerait rien.
        entite.id_suivi = 77
        entite.cree_le = datetime(2026, 9, 28, 8, 30, tzinfo=timezone.utc)
        self.ajoutes.append(entite)

    async def flush(self):
        return None


def test_creer_suivi_renvoie_la_date_et_le_motif_du_controle(
    monkeypatch: pytest.MonkeyPatch,
):
    """Le retour doit porter la date et le motif, pas seulement l'identifiant.

    Sans eux, le compte rendu affiche « controle programme le Invalid Date » et
    efface silencieusement le motif : deux informations perdues sur une seule
    action de confirmation.
    """
    session = _SessionEcriture()
    monkeypatch.setattr(persistance, "_sessions", lambda: session)

    cree = asyncio.run(
        persistance.creer_suivi(
            id_patient=42,
            date_suivi=date(2099, 10, 1),
            motif="Controle radiologique a 3 mois",
            id_examen_origine=7,
        )
    )

    assert cree["id_suivi"] == 77
    assert cree["statut"] == "planifie"
    # Une date, pas une datetime ni un objet : le front la lit telle quelle.
    assert cree["date_suivi"] == "2099-10-01"
    assert cree["motif"] == "Controle radiologique a 3 mois"
    assert cree["id_examen_origine"] == 7
    assert cree["id_patient"] == 42
    assert cree["cree_le"] == "2026-09-28T08:30:00+00:00"


def test_creer_suivi_sans_motif_ne_laisse_pas_un_champ_phantom(
    monkeypatch: pytest.MonkeyPatch,
):
    """Un suivi sans motif doit renvoyer ``motif: null``, pas une cle absente.

    Une cle absente se lirait cote front comme un ``undefined`` affiche dans la
    phrase de confirmation.
    """
    session = _SessionEcriture()
    monkeypatch.setattr(persistance, "_sessions", lambda: session)

    cree = asyncio.run(
        persistance.creer_suivi(id_patient=42, date_suivi=date(2099, 10, 1))
    )

    assert "motif" in cree
    assert cree["motif"] is None
    assert cree["date_suivi"] == "2099-10-01"
