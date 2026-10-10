"""Suivis cliniques, validation du clinicien et revocation des OTP.

Contexte de la migration (Vague 1 du memoire) :
- ``suivis_cliniques`` : controles a venir (une date, un patient, un motif en
  texte libre), programmes depuis la page Resultat et listes sur /suivi de la
  plus proche echeance a la plus lointaine ;
- ``validations_cliniques`` : **journal en ajout** des decisions du clinicien
  (note libre, motif de desaccord). Un desaccord suivi d'une reapprobation
  conserve son motif : l'etat courant se lit dans ``v_etat_validation`` via un
  ``DISTINCT ON``, jamais par ecrasement de ligne ;
- ``otp_codes.revoque_le`` : le desaccord d'un examen retire au patient
  l'acces au code **deja envoye**. Sans cette colonne, un « Desapprouver »
  n'aurait aucun effet : l'OTP est permanent et reutilisable, le patient
  continuerait de lire le resultat rejete. Les lignes sont conservees (trace de
  ce qui a ete notifie), seule la date de revocation est posee.

Aucune validation n'est pre-creee pour les diagnostics deja en base : l'absence
de ligne vaut « sans decision ». Fabrier 1000 validations retroactively
inventerait une tracabilite clinique qui n'a jamais existe.

Revision : 0005 (succede a 0004 le flux patient automatique).
Create Date: 2026-09-27
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# Identifiant de revision : chaine courte unique (prefixe numerique/heure).
revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Cree le suivi et la validation cliniques, et rend l'OTP revocable."""
    op.execute("CREATE TYPE t_statut_suivi AS ENUM ('planifie', 'realise', 'annule')")
    op.execute("CREATE TYPE t_statut_validation AS ENUM ('en_attente', 'approuve', 'desapprouve')")

    op.create_table(
        "suivis_cliniques",
        sa.Column("id_suivi", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("id_patient", sa.BigInteger(), nullable=False),
        sa.Column("id_examen_origine", sa.BigInteger(), nullable=True),
        sa.Column("date_suivi", sa.Date(), nullable=False),
        sa.Column("motif", sa.Text(), nullable=True),
        sa.Column(
            "statut",
            sa.Enum(
                "planifie", "realise", "annule", name="t_statut_suivi", create_constraint=False
            ),
            server_default="planifie",
            nullable=False,
        ),
        sa.Column(
            "cree_le",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["id_patient"], ["patients.id_patient"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["id_examen_origine"], ["examens_image.id_examen"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id_suivi"),
    )
    # Tri de la page /suivi : echeance la plus proche en tete.
    op.execute("CREATE INDEX idx_suivis_echeance ON suivis_cliniques (date_suivi, statut)")

    op.create_table(
        "validations_cliniques",
        sa.Column("id_validation", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("id_examen", sa.BigInteger(), nullable=False),
        sa.Column("id_utilisateur", sa.BigInteger(), nullable=True),
        sa.Column("id_otp", sa.BigInteger(), nullable=True),
        sa.Column(
            "statut",
            sa.Enum(
                "en_attente",
                "approuve",
                "desapprouve",
                name="t_statut_validation",
                create_constraint=False,
            ),
            nullable=False,
        ),
        sa.Column("note_clinique", sa.Text(), nullable=True),
        sa.Column("motif_desaccord", sa.Text(), nullable=True),
        sa.Column(
            "cree_le",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["id_examen"], ["examens_image.id_examen"], ondelete="RESTRICT"),
        # SET NULL : supprimer un compte soignant ne doit pas emporter la
        # trace de sa decision clinique.
        sa.ForeignKeyConstraint(
            ["id_utilisateur"],
            ["utilisateurs.id_utilisateur"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(["id_otp"], ["otp_codes.id_otp"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id_validation"),
    )
    op.execute(
        "CREATE INDEX idx_validations_examen ON validations_cliniques (id_examen, id_validation DESC)"
    )

    op.add_column("otp_codes", sa.Column("revoque_le", sa.TIMESTAMP(timezone=True)))

    op.execute("""
        CREATE VIEW v_etat_validation AS
        SELECT DISTINCT ON (v.id_examen)
               v.id_examen,
               v.id_validation,
               v.statut,
               v.note_clinique,
               v.motif_desaccord,
               v.cree_le,
               u.email AS decide_par
        FROM validations_cliniques v
        LEFT JOIN utilisateurs u ON u.id_utilisateur = v.id_utilisateur
        ORDER BY v.id_examen, v.id_validation DESC
        """)


def downgrade() -> None:
    """Retire le suivi, la validation, la revocation et la vue associee."""
    op.execute("DROP VIEW IF EXISTS v_etat_validation")
    op.drop_column("otp_codes", "revoque_le")
    op.execute("DROP INDEX IF EXISTS idx_validations_examen")
    op.drop_table("validations_cliniques")
    op.execute("DROP INDEX IF EXISTS idx_suivis_echeance")
    op.drop_table("suivis_cliniques")
    op.execute("DROP TYPE IF EXISTS t_statut_validation")
    op.execute("DROP TYPE IF EXISTS t_statut_suivi")
