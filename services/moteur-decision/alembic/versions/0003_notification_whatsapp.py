"""Canal WhatsApp — colonne telephone sur les patients.

Contexte de la migration :
- ``patients`` gagne ``telephone`` (NULL) : c'est ce qui permet d'adresser
  une notification OTP par WhatsApp (via le relais AERIS Baileys) aux
  patients sans adresse email.

Révision : 0003 (succède à 0002 le RBAC).
Create Date: 2026-09-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# Identifiant de révision : chaîne courte unique (préfixe numérique/heure).
revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Ajoute la colonne telephone aux patients (déjà table : ALTER)."""
    op.add_column("patients", sa.Column("telephone", sa.Text(), nullable=True))


def downgrade() -> None:
    """Annule le canal WhatsApp : retire la colonne telephone."""
    op.drop_column("patients", "telephone")