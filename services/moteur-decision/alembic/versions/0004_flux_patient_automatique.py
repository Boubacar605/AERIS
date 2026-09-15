"""Flux patient automatique — nom, prenom, date de naissance et index telephone.

Contexte de la migration :
- ``patients`` gagne ``nom`` et ``prenom`` (TEXT non nul, ``''`` par défaut) et
  ``date_naissance`` (DATE nullable) : le clinicien remplit un en-tête patient
  (nom, prenom, date de naissance, email optionnel, telephone obligatoire)
  sur la page Diagnostic, la cree avant toute analyse.
- les numeros de telephone existants sont **normalises** (chiffres seuls,
  prefixe pays ``221`` implicite) pour servir de cle de dedoublonnage ;
- un **index unique partiel** sur ``telephone`` garantit qu'un patient ne peut
  pas etre enregistre deux fois avec le meme numero (requis par le flux OTP).

Revision : 0004 (succede a 0003 le canal WhatsApp).
Create Date: 2026-09-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# Identifiant de revision : chaine courte unique (prefixe numerique/heure).
revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Ajoute les champs nominatifs du patient et l'index unique telephone.

    L'ordre compte : on normalise puis on dedoublonne **avant** de poser
    l'index unique, sinon une paire de numeros equivalents ("+221…" vs
    "221…") ferait echouer la contrainte.
    """
    op.add_column("patients", sa.Column("nom", sa.Text(), nullable=False, server_default=""))
    op.add_column("patients", sa.Column("prenom", sa.Text(), nullable=False, server_default=""))
    op.add_column("patients", sa.Column("date_naissance", sa.Date(), nullable=True))

    # Normalisation des numeros existants : chiffres seuls + prefixe pays 221.
    op.execute(
        "UPDATE patients SET telephone = regexp_replace(telephone, '[^0-9]', '', 'g') "
        "WHERE telephone IS NOT NULL AND telephone <> ''"
    )
    op.execute(
        "UPDATE patients SET telephone = '221' || telephone "
        "WHERE telephone IS NOT NULL AND telephone <> '' AND telephone NOT LIKE '221%'"
    )

    # Unicite du telephone (cle de dedoublonnage du flux en-tete patient).
    op.execute(
        "CREATE UNIQUE INDEX ux_patients_telephone ON patients (telephone) "
        "WHERE telephone IS NOT NULL AND telephone <> ''"
    )


def downgrade() -> None:
    """Annule le flux patient automatique : index puis colonnes."""
    op.execute("DROP INDEX IF EXISTS ux_patients_telephone")
    op.drop_column("patients", "date_naissance")
    op.drop_column("patients", "prenom")
    op.drop_column("patients", "nom")