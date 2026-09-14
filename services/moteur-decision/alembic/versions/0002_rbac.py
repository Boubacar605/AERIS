"""RBAC — comptes utilisateurs, OTP patient et colonnes patients manquantes.

Contexte de la migration :
- ``patients`` gagne ``email`` (unique, NULL) et ``nom_complet`` : c'est ce qui
  permet d'adresser une notification par OTP après une analyse radiologique.
- ``utilisateurs`` porte les comptes Admin/Clinicien (JWT RBAC).
- ``otp_codes`` stocke les codes à usage unique (6 chiffres, haché SHA-256,
  expiration, plafond de tentatives) adressés aux patients.

Révision : 0002 (succède à 0001 la baseline, posée par les scripts init).
Create Date: 2026-09-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# Identifiant de révision : chaîne courte unique (préfixe numérique/heure).
revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Applique le schéma RBAC : rôle, utilisateurs, OTP et colonnes patient."""
    # --- Domaines énumérés -------------------------------------------------
    # Le type t_role est créé par SQLAlchemy lors du create_table ci-dessous
    # (le pg-ENUM s'auto-crée à la création de "utilisateurs"). Inutile de
    # l'émettre ici : la double création ferait échouer la migration.
    t_role = sa.Enum("admin", "clinicien", name="t_role")

    # --- Colonnes patients (déjà table : ALTER uniquement) -----------------
    op.add_column("patients", sa.Column("email", sa.Text(), nullable=True))
    op.add_column("patients", sa.Column("nom_complet", sa.Text(), nullable=True))
    op.create_unique_constraint("uq_patients_email", "patients", ["email"])

    # --- Table utilisateurs ------------------------------------------------
    op.create_table(
        "utilisateurs",
        sa.Column("id_utilisateur", sa.BigInteger(), sa.Identity(always=True), primary_key=True),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("nom", sa.String(), nullable=False),
        sa.Column("prenom", sa.String(), nullable=False),
        sa.Column("role", t_role, nullable=False),
        sa.Column("mot_de_passe_hash", sa.String(), nullable=False),
        sa.Column("actif", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "cree_le",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("modifie_le", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("email", name="uq_utilisateurs_email"),
    )

    # --- Table OTP ----------------------------------------------------------
    op.create_table(
        "otp_codes",
        sa.Column("id_otp", sa.BigInteger(), sa.Identity(always=True), primary_key=True),
        sa.Column(
            "id_patient",
            sa.BigInteger(),
            sa.ForeignKey("patients.id_patient", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "id_examen",
            sa.BigInteger(),
            sa.ForeignKey("examens_image.id_examen", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("email_destination", sa.Text(), nullable=False),
        sa.Column("code_hash", sa.String(), nullable=False),
        sa.Column("expire_le", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tentatives", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("utilise_le", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cree_le", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    # Consultation des OTP par email (le chemin de vérification le plus fréquent).
    op.create_index("idx_otp_email", "otp_codes", ["email_destination"])
    op.create_index("idx_otp_patient", "otp_codes", ["id_patient"])


def downgrade() -> None:
    """Annule le RBAC : tables, colonnes puis domaine énuméré."""
    op.drop_index("idx_otp_patient", table_name="otp_codes")
    op.drop_index("idx_otp_email", table_name="otp_codes")
    op.drop_table("otp_codes")
    op.drop_table("utilisateurs")

    op.drop_constraint("uq_patients_email", "patients", type_="unique")
    op.drop_column("patients", "nom_complet")
    op.drop_column("patients", "email")

    sa.Enum("admin", "clinicien", name="t_role").drop(
        op.get_bind(), checkfirst=True
    )