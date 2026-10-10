"""Tests du flux patient automatique : en-tête, code auto, approbation OTP.

Le flux (exigences utilisateur) :
- le clinicien remplit un en-tête (nom, prénom, date de naissance, email
  optionnel, téléphone obligatoire) AVANT l'upload ;
- le code patient AER-AAAA-NNNN est généré automatiquement (plus de saisie) ;
- avant d'enregistrer, on vérifie que le téléphone n'existe pas déjà (sinon
  le compte existant est réutilisé) ;
- la notification OTP (email + WhatsApp, ou WhatsApp seul) part uniquement
  sur le bouton « Approuver » de la page Résultat.
"""

from __future__ import annotations

import asyncio
import datetime
import types

import pytest
from app import persistance
from fastapi.testclient import TestClient


def _patient(
    code: str = "AER-2026-0042", telephone: str | None = "221771234567"
) -> types.SimpleNamespace:
    return types.SimpleNamespace(
        id_patient=42,
        code_patient=code,
        nom_complet="Awa Diop",
        email="awa.diop@example.org",
        telephone=telephone,
    )


# ---------------------------------------------------------------------------
# Code patient automatique (format AER-AAAA-NNNN)
# ---------------------------------------------------------------------------


class _SessionFake:
    def __init__(self, codes: list[str]):
        self.codes = codes

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def execute(self, statement, params=None):
        # Simule le filtre LIKE de generer_code_patient : seuls les codes du
        # préfixe de l'année courante ("AER-2026-%") comptent dans la suite.
        prefixe = (params or {}).get("prefix", "").rstrip("%")

        class _Resultat:
            def __init__(self, codes):
                self._codes = codes

            def all(self):
                return [(code,) for code in self._codes]

        return _Resultat(c for c in self.codes if c.startswith(prefixe))


class _SessionMakerFake:
    """Se substitue au ``async_sessionmaker`` (callable -> session factice)."""

    def __init__(self, codes: list[str]):
        self.codes = codes

    def __call__(self):
        return _SessionFake(self.codes)


@pytest.mark.parametrize(
    ("codes", "attendu"),
    [
        ([], "AER-2026-0001"),
        (["AER-2026-0001"], "AER-2026-0002"),
        (["AER-2026-0001", "AER-2026-0003"], "AER-2026-0004"),
        (["AER-2025-0099"], "AER-2026-0001"),  # autre année : la séquence repart
    ],
)
def test_generer_code_patient_sequence_par_annee(monkeypatch, codes, attendu):
    """Le code auto reprend le suffixe max de l'année courante, +1."""
    annee = datetime.datetime.now(datetime.UTC).year
    attendu = attendu.replace("2026", str(annee))
    codes = [c.replace("2026", str(annee)).replace("2025", str(annee - 1)) for c in codes]
    monkeypatch.setattr(persistance, "_sessions", _SessionMakerFake(codes))
    assert asyncio.run(persistance.generer_code_patient()) == attendu


# ---------------------------------------------------------------------------
# POST /routage/patient — création de l'en-tête avant l'analyse
# ---------------------------------------------------------------------------


def test_en_tete_patient_cree_un_code_automatique(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """Téléphone inconnu -> patient créé, code généré par le système."""
    captures: dict = {}

    async def _rechercher(numero: str):
        return None

    async def _creer(**kwargs):
        captures.update(kwargs)
        return _patient()

    monkeypatch.setattr(persistance, "rechercher_patient_par_telephone", _rechercher)
    monkeypatch.setattr(persistance, "creer_patient", _creer)

    reponse = client.post(
        "/routage/patient",
        headers={"Authorization": f"Bearer {clinicien_token}"},
        json={
            "nom": "Diop",
            "prenom": "Awa",
            "date_naissance": "2000-04-12",
            "telephone": "77 123 45 67",
        },
    )
    assert reponse.status_code == 200
    donnees = reponse.json()
    assert donnees["deja_enregistre"] is False
    assert donnees["code_patient"] == "AER-2026-0042"
    # Le téléphone arrive normalisé (forme stockée / index de dédoublonnage).
    assert captures["telephone"] == "77 123 45 67"
    assert captures["nom"] == "Diop"
    assert captures["prenom"] == "Awa"
    assert captures["date_naissance"] == datetime.date(2000, 4, 12)


def test_en_tete_patient_reutilise_le_compte_existant(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """Téléphone déjà enregistré -> aucun doublon, compte réutilisé."""
    existant = _patient(code="AER-2026-0007")

    async def _rechercher(numero: str):
        return existant

    async def _creer(**kwargs):
        raise AssertionError("ne doit pas créer un doublon")

    monkeypatch.setattr(persistance, "rechercher_patient_par_telephone", _rechercher)
    monkeypatch.setattr(persistance, "creer_patient", _creer)

    reponse = client.post(
        "/routage/patient",
        headers={"Authorization": f"Bearer {clinicien_token}"},
        json={"nom": "Diop", "prenom": "Awa", "telephone": "77 123 45 67"},
    )
    assert reponse.status_code == 200
    donnees = reponse.json()
    assert donnees["deja_enregistre"] is True
    assert donnees["code_patient"] == "AER-2026-0007"
    assert donnees["id_patient"] == 42


def test_en_tete_patient_exige_nom_et_telephone_valides(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """Nom vide ou téléphone sans chiffres -> 422, jamais de création muette."""
    appels = []

    async def _rechercher(numero: str):
        appels.append(numero)
        return None

    async def _creer(**kwargs):
        appels.append(kwargs)

    monkeypatch.setattr(persistance, "rechercher_patient_par_telephone", _rechercher)
    monkeypatch.setattr(persistance, "creer_patient", _creer)

    for corps in (
        {"nom": "", "prenom": "Awa", "telephone": "771234567"},
        {"nom": " Diop ", "prenom": "aw a", "telephone": "abc"},
    ):
        reponse = client.post(
            "/routage/patient",
            headers={"Authorization": f"Bearer {clinicien_token}"},
            json=corps,
        )
        assert reponse.status_code == 422, corps
    assert appels == []


# ---------------------------------------------------------------------------
# POST /admin/examens/approuver — déclenchement de la notification OTP
# ---------------------------------------------------------------------------


def test_approuver_examen_envoie_email_et_whatsapp(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """Patient avec email -> canal email+whatsapp (exigence utilisateur).

    Vague 1 : l'approbation porte sur ``id_examen`` (et non plus sur un code
    patient), l'OTP est emis pour cet examen, et la decision est journalisee.
    """
    patient = _patient()
    appels: dict = {}

    async def _patient_de_examen(id_examen: int):
        appels["id_examen"] = id_examen
        return patient.id_patient

    async def _obtenir_par_id(id_patient: int):
        return patient

    async def _emettre(id_patient, id_examen, destination):
        appels["destination"] = destination
        appels["id_otp"] = 512
        return "123456", 512

    async def _journaliser(**champs):
        appels["validation"] = champs
        return {"id_validation": 1, "statut": champs["statut"]}

    async def _notifier(sujet, code_otp):
        appels["code_otp"] = code_otp
        return {"canal": "email+whatsapp", "ok": True}

    monkeypatch.setattr(persistance, "patient_de_examen", _patient_de_examen)
    monkeypatch.setattr(persistance, "obtenir_patient_par_id", _obtenir_par_id)
    monkeypatch.setattr(persistance, "emettre_otp_pour_examen", _emettre)
    monkeypatch.setattr(persistance, "enregistrer_validation", _journaliser)
    monkeypatch.setattr("app.routes.admin.envoyer_notification_otp", _notifier)

    reponse = client.post(
        "/admin/examens/approuver",
        headers={"Authorization": f"Bearer {clinicien_token}"},
        json={"id_examen": 7},
    )
    assert reponse.status_code == 200
    donnees = reponse.json()
    assert donnees["statut"] == "otp_envoye"
    assert donnees["canal"] == "email+whatsapp"
    assert donnees["contact"] == "221771234567"
    assert appels["destination"] == "221771234567"
    assert appels["code_otp"] == "123456"
    # La validation est ecrite AVEC l'identifiant du code notifie : c'est lui
    # que la desapprobation revoque ensuite.
    assert appels["validation"]["id_examen"] == 7
    assert appels["validation"]["id_otp"] == 512
    assert appels["validation"]["statut"] == "approuve"


def test_approuver_examen_whatsapp_seul_sans_email(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """Patient sans email -> WhatsApp seul, contact = numéro normalisé."""
    patient = _patient(telephone="221771234567")
    patient.email = None

    async def _patient_de_examen(id_examen: int):
        return patient.id_patient

    async def _obtenir_par_id(id_patient: int):
        return patient

    async def _emettre(id_patient, id_examen, destination):
        return "654321", 513

    async def _journaliser(**champs):
        return {"id_validation": 2, "statut": "approuve"}

    async def _notifier(sujet, code_otp):
        return {"canal": "whatsapp", "ok": True}

    monkeypatch.setattr(persistance, "patient_de_examen", _patient_de_examen)
    monkeypatch.setattr(persistance, "obtenir_patient_par_id", _obtenir_par_id)
    monkeypatch.setattr(persistance, "emettre_otp_pour_examen", _emettre)
    monkeypatch.setattr(persistance, "enregistrer_validation", _journaliser)
    monkeypatch.setattr("app.routes.admin.envoyer_notification_otp", _notifier)

    reponse = client.post(
        "/admin/examens/approuver",
        headers={"Authorization": f"Bearer {clinicien_token}"},
        json={"id_examen": 7},
    )
    assert reponse.status_code == 200
    assert reponse.json()["canal"] == "whatsapp"
    assert reponse.json()["contact"] == "221771234567"


def test_approuver_examen_unknown_patient_404(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """Examen inconnu -> 404, aucune notification envoyée."""

    async def _patient_de_examen(id_examen: int):
        return None

    async def _emettre(*args, **kwargs):
        raise AssertionError("ne doit pas emettre d'OTP pour un examen inconnu")

    async def _notifier(sujet, code_otp):
        raise AssertionError("ne doit pas notifier un examen inconnu")

    monkeypatch.setattr(persistance, "patient_de_examen", _patient_de_examen)
    monkeypatch.setattr(persistance, "emettre_otp_pour_examen", _emettre)
    monkeypatch.setattr("app.routes.admin.envoyer_notification_otp", _notifier)

    reponse = client.post(
        "/admin/examens/approuver",
        headers={"Authorization": f"Bearer {clinicien_token}"},
        json={"id_examen": 999999},
    )
    assert reponse.status_code == 404


# ---------------------------------------------------------------------------
# Sécurité du dédoublonnage : jamais de rattachement à un autre patient
# ---------------------------------------------------------------------------


def test_en_tete_patient_refuse_une_autre_identite_sur_le_meme_telephone(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """Téléphone connu mais identité différente -> 409, aucun Examens ratio contaminé.

    Régression : le dédoublonnage renvoyait silencieusement le dossier existant,
    rattachant l'examen au patient d'une autre personne.
    """
    existant = _patient(code="AER-2026-0007")

    async def _rechercher(numero: str):
        return existant

    async def _creer(**kwargs):
        raise AssertionError("ne doit pas créer un doublon")

    monkeypatch.setattr(persistance, "rechercher_patient_par_telephone", _rechercher)
    monkeypatch.setattr(persistance, "creer_patient", _creer)

    reponse = client.post(
        "/routage/patient",
        headers={"Authorization": f"Bearer {clinicien_token}"},
        json={"nom": "Sow", "prenom": "Moussa", "telephone": "77 123 45 67"},
    )
    assert reponse.status_code == 409
    assert "identite" in reponse.json()["detail"].lower()
    # Le dossier d'origine ne doit pas être divulgué dans le refus.
    assert "AER-2026-0007" not in reponse.text


def test_en_tete_patient_accepte_identite_equivalente_aux_cassees(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """Casse et espaces différents, même personne -> réutilisation (pas de 409)."""
    # Fiche ancienne : nom/prenom vides, seul nom_complet est renseigné.
    existant = _patient(code="AER-2026-0007")
    existant.nom = ""
    existant.prenom = ""

    async def _rechercher(numero: str):
        return existant

    async def _creer(**kwargs):
        raise AssertionError("ne doit pas créer un doublon")

    monkeypatch.setattr(persistance, "rechercher_patient_par_telephone", _rechercher)
    monkeypatch.setattr(persistance, "creer_patient", _creer)

    reponse = client.post(
        "/routage/patient",
        headers={"Authorization": f"Bearer {clinicien_token}"},
        json={"nom": "  DIOP ", "prenom": "Awa", "telephone": "77 123 45 67"},
    )
    assert reponse.status_code == 200
    assert reponse.json()["deja_enregistre"] is True
    assert reponse.json()["code_patient"] == "AER-2026-0007"


def test_en_tete_patient_refuse_un_email_deja_associe(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """Email déjà pris par un autre patient -> 409 explicite, pas de 500 SQL."""
    porteur = _patient(code="AER-2026-0007")

    async def _aucun_telephone(numero: str):
        return None

    async def _par_email(adresse: str):
        return porteur

    async def _creer(**kwargs):
        raise AssertionError("ne doit pas créer de doublon")

    monkeypatch.setattr(persistance, "rechercher_patient_par_telephone", _aucun_telephone)
    monkeypatch.setattr(persistance, "rechercher_patient_par_email", _par_email)
    monkeypatch.setattr(persistance, "creer_patient", _creer)

    reponse = client.post(
        "/routage/patient",
        headers={"Authorization": f"Bearer {clinicien_token}"},
        json={
            "nom": "Sow",
            "prenom": "Moussa",
            "email": "awa.diop@example.org",
            "telephone": "77 999 88 77",
        },
    )
    assert reponse.status_code == 409
    assert "email" in reponse.json()["detail"].lower()


def test_en_tete_patient_409_si_contrainte_unique_tombe(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """Course concurrente : l'IntegrityError est traduite en 409, pas en 500."""
    from sqlalchemy.exc import IntegrityError

    async def _aucun(numero: str):
        return None

    async def _creer(**kwargs):
        # Forme réelle d'une violation de contrainte unique SQLAlchemy/psycopg.
        raise IntegrityError(
            "INSERT", {}, Exception("duplicate key value violates unique constraint")
        )

    monkeypatch.setattr(persistance, "rechercher_patient_par_telephone", _aucun)
    monkeypatch.setattr(persistance, "rechercher_patient_par_email", _aucun_email)
    monkeypatch.setattr(persistance, "creer_patient", _creer)

    reponse = client.post(
        "/routage/patient",
        headers={"Authorization": f"Bearer {clinicien_token}"},
        json={"nom": "Sow", "prenom": "Moussa", "telephone": "77 555 44 33"},
    )
    assert reponse.status_code == 409


async def _aucun_email(adresse: str):
    return None


# ---------------------------------------------------------------------------
# Notification OTP : un canal en panne ne doit pas masquer la livraison
# ---------------------------------------------------------------------------


def test_approuver_examen_signale_un_envoi_partiel(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """Email OK + WhatsApp HS -> succès partiel, pas un « echec_envoi » trompeur."""
    patient = _patient()

    async def _patient_de_examen(id_examen: int):
        return patient.id_patient

    async def _obtenir_par_id(id_patient: int):
        return patient

    async def _emettre(id_patient, id_examen, destination):
        return "123456", 600

    async def _journaliser(**champs):
        return {"id_validation": 1, "statut": "approuve"}

    async def _notifier(sujet, code_otp):
        return {
            "canal": "email+whatsapp",
            "ok": True,
            "canaux": {"email": True, "whatsapp": False},
            "canaux_oks": ["email"],
            "avertissements": [
                "OTP delivre par email mais l'envoi par whatsapp a echoue " "(canal indisponible)."
            ],
        }

    monkeypatch.setattr(persistance, "patient_de_examen", _patient_de_examen)
    monkeypatch.setattr(persistance, "obtenir_patient_par_id", _obtenir_par_id)
    monkeypatch.setattr(persistance, "emettre_otp_pour_examen", _emettre)
    monkeypatch.setattr(persistance, "enregistrer_validation", _journaliser)
    monkeypatch.setattr("app.routes.admin.envoyer_notification_otp", _notifier)

    reponse = client.post(
        "/admin/examens/approuver",
        headers={"Authorization": f"Bearer {clinicien_token}"},
        json={"id_examen": 7},
    )
    assert reponse.status_code == 200
    donnees = reponse.json()
    assert donnees["statut"] == "otp_partiellement_envoye"
    assert donnees["canaux"] == {"email": True, "whatsapp": False}
    assert donnees["canaux_oks"] == ["email"]
    assert donnees["avertissements"], "le canal en panne doit être signalé"


def test_approuver_examen_echec_total_si_aucun_canal_naboutit(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """Aucun canal livré -> echec_envoi, avec le détail des échecs."""
    patient = _patient()

    async def _patient_de_examen(id_examen: int):
        return patient.id_patient

    async def _obtenir_par_id(id_patient: int):
        return patient

    async def _emettre(id_patient, id_examen, destination):
        return "123456", 600

    async def _journaliser(**champs):
        return {"id_validation": 1, "statut": "approuve"}

    async def _notifier(sujet, code_otp):
        return {
            "canal": "email+whatsapp",
            "ok": False,
            "canaux": {"email": False, "whatsapp": False},
            "canaux_oks": [],
            "avertissements": ["Aucun canal n'a abouti."],
        }

    monkeypatch.setattr(persistance, "patient_de_examen", _patient_de_examen)
    monkeypatch.setattr(persistance, "obtenir_patient_par_id", _obtenir_par_id)
    monkeypatch.setattr(persistance, "emettre_otp_pour_examen", _emettre)
    monkeypatch.setattr(persistance, "enregistrer_validation", _journaliser)
    monkeypatch.setattr("app.routes.admin.envoyer_notification_otp", _notifier)

    reponse = client.post(
        "/admin/examens/approuver",
        headers={"Authorization": f"Bearer {clinicien_token}"},
        json={"id_examen": 7},
    )
    assert reponse.status_code == 200
    assert reponse.json()["statut"] == "echec_envoi"


# ---------------------------------------------------------------------------
# GET /routage/patient — auto-remplissage par numéro déjà connu
# ---------------------------------------------------------------------------


def test_recherche_par_telephone_retrouve_la_fiche(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """Numéro connu -> la fiche est renvoyée pour pré-remplir le formulaire."""
    existant = _patient(code="AER-2026-0007")
    existant.nom = "Diop"
    existant.prenom = "Awa"
    existant.date_naissance = datetime.date(2000, 4, 12)

    async def _rechercher(numero: str):
        return existant

    monkeypatch.setattr(persistance, "rechercher_patient_par_telephone", _rechercher)

    reponse = client.get(
        "/routage/patient",
        headers={"Authorization": f"Bearer {clinicien_token}"},
        params={"telephone": "77 123 45 67"},
    )
    assert reponse.status_code == 200
    donnees = reponse.json()
    assert donnees["trouve"] is True
    assert donnees["code_patient"] == "AER-2026-0007"
    assert donnees["nom"] == "Diop"
    assert donnees["prenom"] == "Awa"
    assert donnees["date_naissance"] == "2000-04-12"


def test_recherche_par_telephone_numero_inconnu(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, clinicien_token: str
):
    """Numéro inconnu -> trouve=false, sans erreur (saisie en cours)."""

    async def _rechercher(numero: str):
        return None

    monkeypatch.setattr(persistance, "rechercher_patient_par_telephone", _rechercher)

    reponse = client.get(
        "/routage/patient",
        headers={"Authorization": f"Bearer {clinicien_token}"},
        params={"telephone": "77 000 00 00"},
    )
    assert reponse.status_code == 200
    assert reponse.json()["trouve"] is False


def test_recherche_par_telephone_saisie_incomplete(client: TestClient, clinicien_token: str):
    """Saisie trop courte -> trouve=false, et surtout aucun appel en base."""
    reponse = client.get(
        "/routage/patient",
        headers={"Authorization": f"Bearer {clinicien_token}"},
        params={"telephone": "7"},
    )
    assert reponse.status_code == 200
    assert reponse.json()["trouve"] is False


def test_recherche_par_telephone_refusee_aux_non_cliniciens(client: TestClient, admin_token: str):
    """La recherche d'identité est réservée au clinicien."""
    reponse = client.get(
        "/routage/patient",
        headers={"Authorization": f"Bearer {admin_token}"},
        params={"telephone": "77 123 45 67"},
    )
    assert reponse.status_code == 403
