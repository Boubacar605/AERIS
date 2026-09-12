"""Environnement Alembic — migrations du schéma PostgreSQL du moteur.

La cible de métadonnées est la base déclarative d'``app.persistance`` :
toute évolution du schéma se fait par migration, jamais à la main.

L'URL de connexion n'est pas figée ici : elle vient de la configuration du
moteur (``DATABASE_URL``), exactement comme dans l'application, pour éviter
toute divergence entre les deux chemins.
"""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app import persistance
from app.config import config as app_config

# La classe de configuration d'Alembic (alembic.ini).
config = context.config

# Journalisation : si alembic.ini possède une section [loggers], on la charge.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Cible des métadonnées : les déclarations ORM du moteur. Alembic compare donc
# toujours ses migrations à ce que l'application sait déjà créer.
target_metadata = persistance.Base.metadata


def _url_connexion() -> str | None:
    """URL réellement utilisée : DATABASE_URL du moteur, sinon sqlalchemy.url."""
    return app_config.database_url or config.get_main_option("sqlalchemy.url")


def run_migrations_offline() -> None:
    """Mode hors ligne : génère le SQL sans connexion.

    Utile pour produire un script SQL de migration sans atteindre la base.
    """
    url = _url_connexion()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Mode en ligne : applique réellement les migrations à la base.

    Le driver psycopg (v3) gère aussi bien le mode synchrone (Alembic) que le
    mode asynchrone (l'application) sur la même URL : pas de duplication.
    """
    url = _url_connexion()
    if not url:
        raise RuntimeError(
            "Aucune URL de connexion : DATABASE_URL absente — impossible de migrer."
        )

    configuration = config.get_section(config.config_ini_section) or {}
    configuration["sqlalchemy.url"] = url
    engine = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with engine.connect() as connexion:
        context.configure(
            connection=connexion,
            target_metadata=target_metadata,
            compare_type=True,
        )

        with context.begin_transaction():
            context.run_migrations()

    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()