"""baseline — état initial du schéma (posé par /infrastructure/postgres/init).

Le schéma relationnel complet (types ENUM, 9 tables, vues d'agrégation,
triggers d'horodatage et données de référence) est construit par les scripts
``/docker-entrypoint-initdb.d`` au premier démarrage du conteneur PostgreSQL,
puis uniquement par des migrations Alembic pour toute évolution suivante.

Cette révision est donc volontairement vide : elle représente cet état
antérieur et fournit la base sur laquelle les futures migrations se chaînent.

Recreated baseline (init-scripts sole source of the initial schema).
Revision ID: 0001
Revises:
Create Date: 2026-09-12
"""

from collections.abc import Sequence

# Re-exportés pour l'autogénération ; inutilisés ici (révision no-op).
# import sqlalchemy as sa
from alembic import op  # noqa: F401

# Identifiant de révision : chaîne courte unique (préfixe numérique/heure).
revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Rien à appliquer : le schéma initial existe déjà (scripts init)."""
    pass


def downgrade() -> None:
    """Rien à annuler : l'annulation relève des scripts de migration futurs."""
    pass
