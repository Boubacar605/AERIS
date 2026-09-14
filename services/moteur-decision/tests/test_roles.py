"""Tests du contrôle d'accès par rôles (admin / clinicien) sur les routes."""

from fastapi.testclient import TestClient


def test_clinicien_refuse_etat_systeme(client: TestClient, clinicien_token: str):
    """Le clinicien n'a pas acces au monitoring systeme (admin uniquement)."""
    reponse = client.get(
        "/etat-systeme", headers={"Authorization": f"Bearer {clinicien_token}"}
    )
    assert reponse.status_code == 403


def test_admin_accede_etat_systeme(client: TestClient, admin_token: str):
    """L'admin consulte le monitoring systeme."""
    reponse = client.get(
        "/etat-systeme", headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert reponse.status_code == 200


def test_clinicien_refuse_sante_services(client: TestClient, clinicien_token: str):
    """La sante des services IA est reservee a l'admin."""
    reponse = client.get(
        "/sante-services", headers={"Authorization": f"Bearer {clinicien_token}"}
    )
    assert reponse.status_code == 403


def test_admin_accede_sante_services(client: TestClient, admin_token: str):
    """L'admin interroge la sante des services IA."""
    reponse = client.get(
        "/sante-services", headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert reponse.status_code == 200


def test_sans_token_refuse(client: TestClient):
    """Endpoint protege sans token -> 401, et non une fuite d'information."""
    reponse = client.get("/etat-systeme")
    assert reponse.status_code == 401


def test_token_invalide_refuse(client: TestClient):
    """Token mal forme -> 401."""
    reponse = client.get(
        "/etat-systeme", headers={"Authorization": "Bearer token.invalide.xyz"}
    )
    assert reponse.status_code == 401


def test_historique_accessible_admin_et_clinicien(
    client: TestClient, admin_token: str, clinicien_token: str
):
    """L'historique est partage entre admin (audit) et clinicien (pratique)."""
    for token in (admin_token, clinicien_token):
        reponse = client.get(
            "/historique", headers={"Authorization": f"Bearer {token}"}
        )
        assert reponse.status_code == 200, f"historique refuse pour {token[:10]}"


def test_routes_admin_reservees_au_role_admin(
    client: TestClient, admin_token: str, clinicien_token: str
):
    """/admin/* est intraitable pour un clinicien."""
    reponse = client.get(
        "/admin/utilisateurs", headers={"Authorization": f"Bearer {clinicien_token}"}
    )
    assert reponse.status_code == 403

    reponse_admin = client.get(
        "/admin/utilisateurs", headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert reponse_admin.status_code == 200
    assert isinstance(reponse_admin.json(), list)


def test_route_analyser_reservee_aux_cliniciens(
    client: TestClient, admin_token: str
):
    """Le role admin est purement IT : il n'analyse pas de radiographies."""
    reponse = client.post(
        "/routage/analyser",
        headers={"Authorization": f"Bearer {admin_token}"},
        files={"fichier": ("cliche.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 50, "image/png")},
    )
    assert reponse.status_code == 403