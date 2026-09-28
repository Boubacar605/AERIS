"""Tests des recommandations cliniques et du partage du compte rendu (Vague 2).

Le risque HERE n'est pas technique, il est clinique. Ces tests verrouillent
donc les regles de prudence du module `recommandations` :

1. **aucune prescription** — le texte oriente, il ne nomme aucun medicament ni
   posologie ;
2. **une positivite n'est jamais une preuve** — le vocabulaire est « en faveur
   de », jamais « vous avez » ;
3. **un examen non valide ne parle pas au patient** — les recommandations
   patient sont vides avant approbation ;
4. **rien n'est partage sans approbation** — l'API refuse, en 409.

Le partage WhatsApp, lui, a une contrainte d'architecture : le code OTP est
stocke hache, il n'est donc pas rejouable depuis la base. Le message doit
pourtant etre complet, et ne pas promettre de lien inutilisable.
"""

from __future__ import annotations

import inspect
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import persistance
from app.recommandations import (
    CONFIANCE_MENTIONNABLE,
    generer_recommandations,
    resumer_verdicts,
)
from app.whatsapp import composer_message_compte_rendu

TB_POSITIF = {"pathologie": "tuberculose", "prediction": "positif", "confiance": 0.88}
PN_POSITIF = {"pathologie": "pneumonie", "prediction": "positif", "confiance": 0.94}
TB_FAIBLE = {"pathologie": "tuberculose", "prediction": "positif", "confiance": 0.41}
TOUT_NEGATIF = [
    {"pathologie": "tuberculose", "prediction": "negatif", "confiance": 0.91},
    {"pathologie": "pneumonie", "prediction": "negatif", "confiance": 0.87},
]

# Mots qui feraient passer une recommandation pour une prescription.
TERMES_PRESCRIPTIQUES = (
    "mg",
    "mg/kg",
    "posologie",
    "amoxicilline",
    "prescrire ",
    "prendre ",
    "trois fois par jour",
)


# ---------------------------------------------------------------------------
# Precautions cliniques
# ---------------------------------------------------------------------------


def test_une_positivite_n_est_jamais_une_affirmation():
    """Le libele porte le cadre « en faveur de » : le modele n'etablit aucun
    diagnostic. On cherche la formule, pas la preposition exacte, pour que la
    redaction reste libre (« en faveur d'une suspicion », « en faveur de
    signes »)."""
    reco = generer_recommandations([TB_POSITIF], valide=True)
    patients = [r for r in reco if r.cible == "patient"]
    assert patients
    assert any("en faveur" in r.texte.lower() for r in patients)

    for r in reco:
        minuscule = r.texte.lower()
        for interdit in ("vous avez", "diagnostic de", "atteint de", "souffre de", "est atteint"):
            assert interdit not in minuscule, f"{interdit!r} dans {r.texte!r}"


def test_aucune_recommandation_ne_prescrit_de_traitement():
    """Une orientation de prise en charge, pas une ordonnance."""
    reco = generer_recommandations([TB_POSITIF, PN_POSITIF], valide=True)
    for r in reco:
        minuscule = r.texte.lower()
        for terme in TERMES_PRESCRIPTIQUES:
            assert terme not in minuscule, f"{terme!r} dans {r.texte!r}"


def test_une_positivite_trop_faible_ne_produit_pas_d_orientation():
    """Sous le seuil de mention, la sortie est indistinguishable d'un bruit :
    mieux vaut ne rien recommander que surinterpreter."""
    reco = generer_recommandations([TB_FAIBLE], valide=False)
    assert all("tuberculose" not in r.texte.lower() for r in reco)
    assert reco, "une recommandation de priorite reste attendue"


def test_les_deux_positivites_signalent_le_croisement():
    """TB et PN se confondent sur l'image : deux positivites appellent une
    relecture, pas deux diagnostics."""
    reco = generer_recommandations([TB_POSITIF, PN_POSITIF], valide=False)
    croisements = [r for r in reco if "croisement" in r.texte.lower() or "relecture" in r.texte.lower()]
    assert croisements, "l'avertissement de croisement est attendu"
    assert all(r.cible == "clinicien" for r in croisements)


def test_aucune_recommandation_patient_avant_approbation():
    """Un examen non valide ne parle pas au patient : il n'est pas livrable."""
    reco = generer_recommandations([PN_POSITIF], valide=False)
    assert all(r.cible == "clinicien" for r in reco)


def test_les_recommandations_patient_existent_apres_approbation():
    reco = generer_recommandations([PN_POSITIF], valide=True)
    patients = [r for r in reco if r.cible == "patient"]
    assert patients
    assert any("consulter" in " ".join(r.tags) for r in patients)


def test_examen_sans_verdict_positif_reste_prudent():
    """Deux verdicts negatifs ne produisent aucune orientation de pathologie,
    et le rappel de correlation clinique reste joint."""
    reco = generer_recommandations(TOUT_NEGATIF, valide=True)
    assert all("pneumonie" not in r.texte.lower() for r in reco)
    assert any("consulter" in " ".join(r.tags) for r in reco)


@pytest.mark.parametrize(
    "verdicts,attendu",
    [
        ([TB_POSITIF], "tuberculose"),
        ([PN_POSITIF], "pneumonie"),
        (TOUT_NEGATIF, "aucun signe"),
        ([], "aucun verdict"),
        ([TB_FAIBLE], "non confirmee"),
    ],
)
def test_le_resume_une_phrase(verdicts: list[dict], attendu: str):
    """Le resume tient en une phrase : le canal est etroit, le detail reste
    dans le portail."""
    resume = resumer_verdicts(verdicts)
    assert attendu in resume
    assert "\n" not in resume


# ---------------------------------------------------------------------------
# Le message partage
# ---------------------------------------------------------------------------


def test_le_message_ne_promet_pas_de_code_illisible():
    """Le code OTP est hache en base : il ne peut pas etre rejoue depuis la
    base. Le message renvoie donc au code deja recu, sans lien a parametre
    qui promettrait un acces immediat."""
    message = composer_message_compte_rendu(
        nom_patient="Awa Diop",
        resume="modele en faveur de pneumonie (94 %)",
        recommandations=["Une radiographie de controle est recommandee."],
        url="http://localhost:3000",
    )
    assert "resultat?otp=" not in message
    assert "code de consultation que vous avez recu" in message
    assert "Awa Diop" in message


def test_le_message_ne_comporte_pas_de_bloc_vide_sans_recommandation():
    """Pas de section « Suite a donner » vide : on n'envoie pas un pave au
    patient qui n'a rien a faire."""
    message = composer_message_compte_rendu(
        nom_patient=None,
        resume="aucun signe en faveur d'une pathologie",
        recommandations=[],
        url="http://localhost:3000",
    )
    assert "Suite a donner" not in message
    assert message.startswith("Bonjour,")


def test_le_seuil_de_mention_est_unique():
    """Une seule definition du seuil : recommandations et resume ne peuvent pas
    diverger sur ce qui est « significatif »."""
    assert 0 < CONFIANCE_MENTIONNABLE < 1


# ---------------------------------------------------------------------------
# API : le partage est refuse sans approbation
# ---------------------------------------------------------------------------


def test_partager_refuse_un_examen_non_approuve(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """C'est la regle la plus importante de l'API : on ne transmet pas par
    WhatsApp un resultat qu'un clinicien n'a pas arrete."""

    async def _patient(id_examen: int):
        return 7

    async def _etat(id_examen: int):
        return {"statut": "sans_decision"}

    async def _verdits(id_examen: int):
        return [PN_POSITIF]

    monkeypatch.setattr(persistance, "patient_de_examen", _patient)
    monkeypatch.setattr(persistance, "etat_validation", _etat)
    monkeypatch.setattr(persistance, "verdits_cliniques_examen", _verdits)

    reponse = client.post(
        "/examens/23/partager",
        headers={"Authorization": f"Bearer {clinicien_token}"},
    )
    assert reponse.status_code == 409
    assert "approuve" in reponse.json()["detail"]


def test_partager_refuse_un_examen_inconnu(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    async def _patient(id_examen: int):
        return None

    monkeypatch.setattr(persistance, "patient_de_examen", _patient)

    reponse = client.post(
        "/examens/999999/partager",
        headers={"Authorization": f"Bearer {clinicien_token}"},
    )
    assert reponse.status_code == 404


def test_recommandations_reservees_au_clinicien(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, admin_token: str
):
    """L'admin n'a pas a produire d'orientation de prise en charge : ce n'est
    pas son role, et la route le dit."""
    reponse = client.get(
        "/recommandations/23",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert reponse.status_code == 403


def test_recommandations_d_un_examen_sans_verdict(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """Pas de verdict = pas de recommandation. Un 409 dit la realite, il ne
    renvoie pas une liste vide qui laisserait croire a un examen normal."""

    async def _patient(id_examen: int):
        return 7

    async def _verdits(id_examen: int):
        return []

    monkeypatch.setattr(persistance, "patient_de_examen", _patient)
    monkeypatch.setattr(persistance, "verdits_cliniques_examen", _verdits)

    reponse = client.get(
        "/recommandations/23",
        headers={"Authorization": f"Bearer {clinicien_token}"},
    )
    assert reponse.status_code == 409


# ---------------------------------------------------------------------------
# API : le message ne promet un code que s'il en existe un actif
# ---------------------------------------------------------------------------


def test_partager_refuse_quand_aucun_code_actif_n_atteint_le_patient(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """Validation presente mais OTP jamais emis : le partage doit echouer.

    L'emission du code peut avoir echoue a l'approbation (SMTP indisponible,
    relais absent) alors que la validation, elle, est deja journalisee. Sans
    ce controle, le message partirait avec « utilisez le code que vous avez
    recu » — vers un code que le patient n'a jamais recu, et qu'il ne peut pas
    deviner. L'echec visible vaut mieux que la promesse fausse.
    """
    async def _patient(id_examen: int):
        return 7

    async def _etat(id_examen: int):
        return {"statut": "approuve"}

    async def _verdits(id_examen: int):
        return [PN_POSITIF]

    async def _dossier(id_patient: int):
        return SimpleNamespace(
            nom_complet="Awa Diop",
            code_patient="AER-2026-0009",
            telephone="22170000000",
        )

    async def _aucun_code(id_patient: int):
        return False

    monkeypatch.setattr(persistance, "patient_de_examen", _patient)
    monkeypatch.setattr(persistance, "etat_validation", _etat)
    monkeypatch.setattr(persistance, "verdits_cliniques_examen", _verdits)
    monkeypatch.setattr(persistance, "obtenir_patient_par_id", _dossier)
    monkeypatch.setattr(persistance, "existe_otp_actif_patient", _aucun_code)

    envoye = False

    async def _whatsapp(telephone: str, message: str):
        nonlocal envoye
        envoye = True
        return True

    monkeypatch.setattr("app.routes.clinique.envoyer_message_whatsapp", _whatsapp)

    reponse = client.post(
        "/examens/23/partager",
        headers={"Authorization": f"Bearer {clinicien_token}"},
    )

    assert reponse.status_code == 409
    detail = reponse.json()["detail"].lower()
    assert "otp" in detail
    assert envoye is False, "le message ne doit pas partir sans code actif"


def test_un_code_revoque_ne_compte_pas_comme_actif():
    """La revocation retire l'acces : un code revoque ne vaut pas plus qu'un
    code jamais emis. La requete filtre donc sur ``revoque_le IS NULL``."""
    source = inspect.getsource(persistance.existe_otp_actif_patient)
    assert "revoque_le IS NULL" in source
    assert "id_patient" in source
