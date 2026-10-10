"""Persistance PostgreSQL du moteur de decision.

Architecture en couches (les deux étages restent indépendants) :

1. le **registre en mémoire** (``registre_diagnostics``) reste la source chaude :
   il alimente ``/historique`` et ``/etat-systeme`` sans latence ;
2. ce module ajoute une couche **durable** qui ne bloque jamais le pipeline
   d'inference :
   - chaque diagnostic est déposé dans un file asyncio (``deque`` + worker) ;
   - un worker arrière-plan fl ushe la file par lots vers PostgreSQL ;
   - au démarrage, le registre est **réhydraté** depuis la base : après un
     redémarrage du moteur, l'historique, le compteur de requêtes et les
     moyennes d'inférence retrouvent exactement leur état précédent.

Si aucune ``DATABASE_URL`` n'est configurée (développement, tests), la
persistance reste inactive et le moteur fonctionne comme avant, sur la
mémoire seule : aucun repli fragile, aucun crash.
"""

import asyncio
import hashlib
import logging
from collections import deque
from datetime import UTC, datetime
from datetime import date as date_naissance

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    bindparam,
    text,
)
from sqlalchemy import (
    Enum as SqlEnum,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.config import config
from app.whatsapp import normaliser_numero

_logger = logging.getLogger("aeris.persistance")

CAPACITE_REHYDRATATION = 100
MAX_TENTATIVES_PERSISTANCE = 5
MAX_TENTATIVES_OTP = 5

# ---------------------------------------------------------------------------
# Modèles ORM (miroir du schéma SQL infrastructure/postgres/init/02-schema.sql).
# Les scripts du conteneur créent le schéma au premier boot ; le moteur
# n'intervient que via migrations Alembic pour les évolutions futures.
# ---------------------------------------------------------------------------


class Base(DeclarativeBase):
    """Base déclarative commune aux modèles du moteur."""


def _enum(*valeurs: str, nom: str) -> SqlEnum:
    """Énumération native Postgres, alignée sur les types du schéma."""
    return SqlEnum(*valeurs, name=nom, native_enum=True, create_constraint=False)


enum_pathologie = _enum("tuberculose", "pneumonie", nom="t_pathologie")
enum_destination = _enum("edge", "cloud", nom="t_destination")
enum_verdict = _enum("positif", "negatif", nom="t_statut_verdict")
enum_statut = _enum("completed", "failed", nom="t_statut_analyse")
enum_contexte = _enum("auto", "tuberculose", "pneumonie", "general", nom="t_contexte_depistage")
enum_decision_escalade = _enum(
    "arbitrage_a_prevalu",
    "arbitrage_conserve_initial",
    "escalade_impossible",
    nom="t_decision_escalade",
)
enum_role = _enum("admin", "clinicien", nom="t_role")
# Validation clinique (Vague 1) : journal en ajout, l'etat courant se lit via
# DISTINCT ON dans v_etat_validation. « en_attente » n'est jamais cree en
# masse — l'absence de ligne vaut deja « a valider », sa presence signifie que
# le clinicien a explicitement differe son verdict (et programme un suivi).
enum_statut_validation = _enum("en_attente", "approuve", "desapprouve", nom="t_statut_validation")
enum_statut_suivi = _enum("planifie", "realise", "annule", nom="t_statut_suivi")


class Patient(Base):
    __tablename__ = "patients"

    id_patient: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code_patient: Mapped[str] = mapped_column(String, unique=True)
    sexe: Mapped[str | None] = mapped_column(String(1))
    annee_naissance: Mapped[int | None] = mapped_column(Integer)
    # En-tête patient (migration 0004) : nom et prénom séparés, date de
    # naissance ; nom_complet reste la forme d'affichage prenom + nom.
    nom: Mapped[str] = mapped_column(Text, default="")
    prenom: Mapped[str] = mapped_column(Text, default="")
    date_naissance: Mapped[date_naissance | None] = mapped_column(Date)
    note: Mapped[str | None] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(Text, unique=True)
    telephone: Mapped[str | None] = mapped_column(Text)
    nom_complet: Mapped[str | None] = mapped_column(Text)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))


class ExamenImage(Base):
    __tablename__ = "examens_image"

    id_examen: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    id_patient: Mapped[int] = mapped_column(BigInteger, ForeignKey("patients.id_patient"))
    code_examen: Mapped[str] = mapped_column(String, unique=True)
    nom_fichier: Mapped[str] = mapped_column(String)
    format_fichier: Mapped[str | None] = mapped_column(String)
    taille_octets: Mapped[int] = mapped_column(BigInteger, default=0)
    hash_contenu: Mapped[str] = mapped_column(String, unique=True)
    chemin_stockage: Mapped[str | None] = mapped_column(String)
    importer_le: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class ModeleIA(Base):
    __tablename__ = "modeles_ia"

    id_modele: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    identifiant_code: Mapped[str] = mapped_column(String, unique=True)
    pathologie: Mapped[str] = mapped_column(enum_pathologie)
    environnement: Mapped[str] = mapped_column(enum_destination)
    version_modele: Mapped[str] = mapped_column(String)
    libelle: Mapped[str | None] = mapped_column(String)
    actif: Mapped[bool] = mapped_column(Boolean, default=True)


class VersionConfiguration(Base):
    __tablename__ = "versions_configuration"

    id_version: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    libelle: Mapped[str | None] = mapped_column(String)
    seuil_cpu: Mapped[float] = mapped_column(Float)
    seuil_ram: Mapped[float] = mapped_column(Float)
    seuil_latence_ms: Mapped[float] = mapped_column(Float)
    confiance_escalade: Mapped[float | None] = mapped_column(Float)
    confiance_indetermine: Mapped[float | None] = mapped_column(Float)
    profilage_active: Mapped[bool] = mapped_column(Boolean, default=True)
    seuil_ratio_carre_inf: Mapped[float | None] = mapped_column(Float)
    seuil_ratio_carre_sup: Mapped[float | None] = mapped_column(Float)
    seuil_ratio_pn: Mapped[float | None] = mapped_column(Float)
    format_image_tb: Mapped[str | None] = mapped_column(String)
    format_image_pn: Mapped[str | None] = mapped_column(String)
    active_a_partir: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    active_jusqu_a: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Diagnostic(Base):
    __tablename__ = "diagnostics"

    id_diagnostic: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    id_examen: Mapped[int] = mapped_column(BigInteger, ForeignKey("examens_image.id_examen"))
    id_version_configuration: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("versions_configuration.id_version")
    )
    contexte_depistage: Mapped[str] = mapped_column(enum_contexte, default="auto")
    destination_choisie: Mapped[str] = mapped_column(enum_destination)
    raison_decision: Mapped[str] = mapped_column(Text)
    cpu_pourcentage: Mapped[float | None] = mapped_column(Float)
    ram_pourcentage: Mapped[float | None] = mapped_column(Float)
    latence_reseau_ms: Mapped[float | None] = mapped_column(Float)
    reseau_disponible: Mapped[bool | None] = mapped_column(Boolean)
    temps_total_ms: Mapped[float] = mapped_column(Float, default=0.0)
    temps_escalade_ms: Mapped[float | None] = mapped_column(Float)
    statut: Mapped[str] = mapped_column(enum_statut, default="completed")
    execute_le: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class ProfilImageAnalyse(Base):
    __tablename__ = "profils_images_analysees"

    id_profil: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    id_diagnostic: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("diagnostics.id_diagnostic"), unique=True
    )
    format_image: Mapped[str | None] = mapped_column(String)
    largeur_px: Mapped[int | None] = mapped_column(Integer)
    hauteur_px: Mapped[int | None] = mapped_column(Integer)
    ratio_largeur_hauteur: Mapped[float | None] = mapped_column(Float)
    mode_canaux: Mapped[str | None] = mapped_column(String)
    taille_octets: Mapped[int | None] = mapped_column(BigInteger)
    indecodable: Mapped[bool] = mapped_column(Boolean, default=False)
    specialistes_admissibles: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list)
    cle_regle: Mapped[str | None] = mapped_column(String)
    regle_appliquee: Mapped[str | None] = mapped_column(Text)
    specialiste_ecarte: Mapped[str | None] = mapped_column(enum_pathologie)
    raison: Mapped[str | None] = mapped_column(Text)


class ResultatPathologique(Base):
    __tablename__ = "resultats_pathologiques"
    __table_args__ = (UniqueConstraint("id_diagnostic", "pathologie"),)

    id_resultat: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    id_diagnostic: Mapped[int] = mapped_column(BigInteger, ForeignKey("diagnostics.id_diagnostic"))
    id_modele: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("modeles_ia.id_modele"))
    pathologie: Mapped[str] = mapped_column(enum_pathologie)
    prediction: Mapped[str] = mapped_column(enum_verdict)
    confiance_finale: Mapped[float] = mapped_column(Float)
    confiance_initiale: Mapped[float | None] = mapped_column(Float)
    source_finale: Mapped[str] = mapped_column(enum_destination)
    source_initiale: Mapped[str | None] = mapped_column(enum_destination)
    determinant: Mapped[bool] = mapped_column(Boolean, default=True)
    temps_inference_ms: Mapped[float] = mapped_column(Float, default=0.0)
    rang: Mapped[int] = mapped_column(Integer, default=1)


class EscaladeControle(Base):
    __tablename__ = "escalades_controle"

    id_escalade: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    id_diagnostic: Mapped[int] = mapped_column(BigInteger, ForeignKey("diagnostics.id_diagnostic"))
    id_resultat: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("resultats_pathologiques.id_resultat")
    )
    pathologie: Mapped[str] = mapped_column(enum_pathologie)
    source_initiale: Mapped[str] = mapped_column(enum_destination)
    confiance_initiale: Mapped[float] = mapped_column(Float)
    source_controle: Mapped[str] = mapped_column(enum_destination)
    confiance_controle: Mapped[float] = mapped_column(Float)
    decision: Mapped[str] = mapped_column(enum_decision_escalade)
    raison: Mapped[str | None] = mapped_column(Text)
    execute_le: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class Utilisateur(Base):
    __tablename__ = "utilisateurs"

    id_utilisateur: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    nom: Mapped[str] = mapped_column(String, nullable=False)
    prenom: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[str] = mapped_column(enum_role, nullable=False)
    mot_de_passe_hash: Mapped[str] = mapped_column(String, nullable=False)
    actif: Mapped[bool] = mapped_column(Boolean, default=True)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))
    modifie_le: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CodeOtp(Base):
    __tablename__ = "otp_codes"

    id_otp: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    id_patient: Mapped[int] = mapped_column(BigInteger, ForeignKey("patients.id_patient"))
    id_examen: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("examens_image.id_examen"))
    email_destination: Mapped[str] = mapped_column(Text, nullable=False)
    code_hash: Mapped[str] = mapped_column(String, nullable=False)
    expire_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    tentatives: Mapped[int] = mapped_column(Integer, default=0)
    utilise_le: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Revocation par le clinicien (Vague 1) : un examen desapprove retire au
    # patient l'acces au code deja envoye. Le code reste en base (trace de ce
    # qui a ete notifie) mais n'est plus accepte par verifier_otp.
    revoque_le: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))


class SuiviClinique(Base):
    """Controle a venir (Vague 1) : date, patient, motif en texte libre."""

    __tablename__ = "suivis_cliniques"

    id_suivi: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    id_patient: Mapped[int] = mapped_column(BigInteger, ForeignKey("patients.id_patient"))
    id_examen_origine: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("examens_image.id_examen")
    )
    date_suivi: Mapped[date_naissance] = mapped_column(Date, nullable=False)
    motif: Mapped[str | None] = mapped_column(Text)
    statut: Mapped[str] = mapped_column(enum_statut_suivi, default="planifie")
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))


class ValidationClinique(Base):
    """Decision du clinicien sur un examen (Vague 1), journal en ajout.

    Une ligne par decision : un desaccord suivi d'une reapprobation conserve
    son motif. L'etat courant de l'examen se lit dans v_etat_validation.
    """

    __tablename__ = "validations_cliniques"

    id_validation: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    id_examen: Mapped[int] = mapped_column(BigInteger, ForeignKey("examens_image.id_examen"))
    id_utilisateur: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("utilisateurs.id_utilisateur")
    )
    id_otp: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("otp_codes.id_otp"))
    statut: Mapped[str] = mapped_column(enum_statut_validation, nullable=False)
    note_clinique: Mapped[str | None] = mapped_column(Text)
    motif_desaccord: Mapped[str | None] = mapped_column(Text)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))


# ---------------------------------------------------------------------------
# État du worker (activé uniquement si DATABASE_URL est fournie et joignable)
# ---------------------------------------------------------------------------

_engine = None
_sessions: async_sessionmaker[AsyncSession] | None = None
_file_attente: deque[dict] = deque()
_tache_worker: asyncio.Task | None = None
_persistance_active = False


def active() -> bool:
    """Vrai si la persistance PostgreSQL est opérationnelle."""
    return _persistance_active


# ---------------------------------------------------------------------------
# Clés techniques
# ---------------------------------------------------------------------------

CODE_PATIENT_DEFAUT = "AERIS-SUJET-ANONYME"
CODE_EXAMEN_PREFIXE = "EXA"


def _hacher_contenu(contenu: bytes) -> str:
    return hashlib.sha256(contenu).hexdigest()


# ---------------------------------------------------------------------------
# Cycle de vie
# ---------------------------------------------------------------------------


async def demarrer() -> bool:
    """Tente d'activer la persistance. Retourne True en cas de succès."""
    global _engine, _sessions, _persistance_active, _tache_worker

    if not config.database_url:
        _logger.info("DATABASE_URL absente : persistance inactivée (registre mémoire seul)")
        return False

    _engine = create_async_engine(
        config.database_url,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=5,
    )
    _sessions = async_sessionmaker(_engine, expire_on_commit=False)

    # Sondage léger : si la base est injoignable, on dégrade en mémoire proprement.
    try:
        async with _engine.connect() as connexion:
            await connexion.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001 - toute cause rend la base injoignable
        _logger.warning("Base injoignable (%s) : persistance inactivée", exc)
        await _engine.dispose()
        _engine = None
        _sessions = None
        return False

    await _creer_schema_si_absent()
    await _assurer_referentiels()

    _persistance_active = True
    _tache_worker = asyncio.create_task(_boucle_persistance())
    _logger.info("Persistance PostgreSQL activée")
    return True


async def arreter() -> None:
    """Ferme proprement : dernier flush, puis arrêt du worker et du moteur."""
    global _tache_worker, _persistance_active
    if not _persistance_active:
        return
    _persistance_active = False
    await _flush_si_attente()
    if _tache_worker is not None:
        _tache_worker.cancel()
        try:
            await _tache_worker
        except asyncio.CancelledError:
            pass
    if _engine is not None:
        await _engine.dispose()


async def _creer_schema_si_absent() -> None:
    """Garde-fou hors conteneur : crée les tables si la base est vide.

    En environnement Docker le schéma complet (types, vues, triggers, seed)
    est construit par les scripts ``/docker-entrypoint-initdb.d`` au premier
    boot ; ``create_all`` n'intervient que sur ce qui manquerait.
    """
    async with _engine.begin() as connexion:
        await connexion.run_sync(Base.metadata.create_all)
    await _ajouter_colonnes_manquantes()


async def _ajouter_colonnes_manquantes() -> None:
    """Complète ``create_all``, qui ne sait que créer, jamais modifier.

    ``create_all`` ne couvre ni les colonnes d'une table déjà existante, ni les
    vues (absentes du métadata ORM). Les deux objets ci-dessous sont donc
    posés explicitement, et de façon idempotente : ``ADD COLUMN IF NOT EXISTS``
    et ``CREATE OR REPLACE VIEW``.

    - ``otp_codes.revoque_le`` : ajoutée par la migration 0005, absente des
      bases créées avant elle ;
    - ``v_etat_validation`` : état courant de validation d'un examen (Vague 1).
    """
    async with _engine.begin() as connexion:
        await connexion.execute(
            text("ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS revoque_le TIMESTAMPTZ")
        )
        await connexion.execute(text("""
                CREATE OR REPLACE VIEW v_etat_validation AS
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
                 """))
        await connexion.execute(text("""
                CREATE OR REPLACE VIEW v_protocole_validation AS
                SELECT
                    (SELECT COUNT(DISTINCT d.id_examen)
                       FROM diagnostics d
                      WHERE d.statut = 'completed') AS examens_analyses,
                    (SELECT COUNT(*) FROM v_etat_validation
                      WHERE statut = 'approuve') AS examens_approuves,
                    (SELECT COUNT(*) FROM v_etat_validation
                      WHERE statut = 'desapprouve') AS examens_desapprouves,
                    (SELECT COUNT(*) FROM v_etat_validation
                      WHERE statut = 'en_attente') AS examens_en_attente,
                    (SELECT COUNT(DISTINCT d.id_examen)
                       FROM diagnostics d
                      WHERE d.statut = 'completed'
                        AND NOT EXISTS (SELECT 1 FROM v_etat_validation v
                                         WHERE v.id_examen = d.id_examen
                                           AND v.statut = 'approuve')) AS examens_non_approuves,
                    (SELECT COUNT(*) FROM validations_cliniques) AS decisions_journalisees,
                    (SELECT COUNT(*) FROM otp_codes
                      WHERE revoque_le IS NOT NULL) AS otp_revoques,
                    (SELECT COUNT(*) FROM suivis_cliniques
                      WHERE statut = 'planifie') AS controles_a_venir,
                    (SELECT COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (v.cree_le - d.execute_le)) / 3600), 1), 0)
                       FROM validations_cliniques v
                       JOIN diagnostics d ON d.id_examen = v.id_examen) AS delai_moyen_heures
                """))


async def _assurer_referentiels() -> None:
    """Garantit les référentiels minimaux (idempotent).

    Supprime toute dépendance au script seed : le moteur fonctionne même sur
    une base créée uniquement par les modèles ORM.
    """
    async with _sessions() as session:
        async with session.begin():
            resultat_codes = await session.execute(text("SELECT identifiant_code FROM modeles_ia"))
            existants = {m for m in resultat_codes.scalars().all()}
            for code, patho, env in (
                ("tb-edge", "tuberculose", "edge"),
                ("tb-cloud", "tuberculose", "cloud"),
                ("pn-edge", "pneumonie", "edge"),
                ("pn-cloud", "pneumonie", "cloud"),
            ):
                if code not in existants:
                    session.add(
                        ModeleIA(
                            identifiant_code=code,
                            pathologie=patho,
                            environnement=env,
                            version_modele="1.0",
                            libelle=f"Classifieur {patho.upper()} {env.upper()}",
                        )
                    )

            resultat_version = await session.execute(
                text(
                    "SELECT id_version FROM versions_configuration "
                    "WHERE active_jusqu_a IS NULL LIMIT 1"
                )
            )
            courante = resultat_version.scalar()
            if courante is None:
                session.add(
                    VersionConfiguration(
                        libelle="Version initiale 2026",
                        seuil_cpu=float(config.seuil_cpu),
                        seuil_ram=float(config.seuil_ram),
                        seuil_latence_ms=float(config.seuil_latence_ms),
                        confiance_escalade=config.seuil_confiance_escalade,
                        confiance_indetermine=config.seuil_confiance_indetermine,
                        profilage_active=config.profilage_active,
                        seuil_ratio_carre_inf=config.seuil_ratio_carre_inf,
                        seuil_ratio_carre_sup=config.seuil_ratio_carre_sup,
                        seuil_ratio_pn=config.seuil_ratio_pn,
                        format_image_tb=config.format_image_tb,
                        format_image_pn=config.format_image_pn,
                    )
                )

            await _assurer_admin_initial(session)
            await _assurer_clinicien_initial(session)


# ---------------------------------------------------------------------------
# Helpers RBAC : utilisateurs, patients, OTP
# ---------------------------------------------------------------------------

_MAX_TENTATIVES_OTP = 5


async def _assurer_admin_initial(session: AsyncSession) -> None:
    """Cree le compte admin initial si aucun admin actif n'existe."""
    from app.authentification import hacher_mot_de_passe

    resultat = await session.execute(
        text(
            "SELECT id_utilisateur FROM utilisateurs WHERE role = 'admin' AND actif = true LIMIT 1"
        )
    )
    if resultat.scalar() is not None:
        return

    hash_mdp = hacher_mot_de_passe(config.admin_initial_mot_de_passe)
    admin = Utilisateur(
        email=config.admin_initial_email,
        nom="Admin",
        prenom="AERIS",
        role="admin",
        mot_de_passe_hash=hash_mdp,
        actif=True,
    )
    session.add(admin)
    _logger.info("Admin initial cree : %s", config.admin_initial_email)


async def _assurer_clinicien_initial(session: AsyncSession) -> None:
    """Cree le compte clinicien initial si aucun clinicien actif n'existe.

    Complementaire de :func:`_assurer_admin_initial` : les routes de
    diagnostic sont reservees au role clinicien, il faut donc au moins un
    compte exploitable sur un demarrage vierge (demonstration devant jury et
    scenarios d'experimentation).
    """
    from app.authentification import hacher_mot_de_passe

    if not config.clinicien_initial_email:
        return

    resultat = await session.execute(
        text(
            "SELECT id_utilisateur FROM utilisateurs "
            "WHERE role = 'clinicien' AND actif = true LIMIT 1"
        )
    )
    if resultat.scalar() is not None:
        return

    hash_mdp = hacher_mot_de_passe(config.clinicien_initial_mot_de_passe)
    clinicien = Utilisateur(
        email=config.clinicien_initial_email,
        nom="Clinicien",
        prenom="AERIS",
        role="clinicien",
        mot_de_passe_hash=hash_mdp,
        actif=True,
    )
    session.add(clinicien)
    _logger.info("Clinicien initial cree : %s", config.clinicien_initial_email)


async def obtenir_utilisateur_par_email(email: str) -> Utilisateur | None:
    if not _sessions:
        return None
    async with _sessions() as session:
        resultat = await session.execute(
            text("SELECT id_utilisateur FROM utilisateurs WHERE email = :email"),
            {"email": email},
        )
        id_u = resultat.scalar()
        if id_u is None:
            return None
        return await session.get(Utilisateur, id_u)


async def obtenir_utilisateur_par_id(id_utilisateur: int) -> Utilisateur | None:
    if not _sessions:
        return None
    async with _sessions() as session:
        return await session.get(Utilisateur, id_utilisateur)


async def lister_utilisateurs() -> list[dict]:
    if not _sessions:
        return []
    async with _sessions() as session:
        resultat = await session.execute(
            text(
                "SELECT id_utilisateur, email, nom, prenom, role, actif, cree_le "
                "FROM utilisateurs ORDER BY id_utilisateur"
            )
        )
        return [
            {
                "id_utilisateur": r[0],
                "email": r[1],
                "nom": r[2],
                "prenom": r[3],
                "role": r[4],
                "actif": r[5],
                "cree_le": _iso(r[6]),
            }
            for r in resultat.all()
        ]


async def creer_utilisateur(
    email: str,
    nom: str,
    prenom: str,
    role: str,
    mot_de_passe_hash: str,
) -> Utilisateur:
    from app.authentification import hacher_mot_de_passe

    async with _sessions() as session:
        async with session.begin():
            utilisateur = Utilisateur(
                email=email,
                nom=nom,
                prenom=prenom,
                role=role,
                mot_de_passe_hash=(
                    hacher_mot_de_passe(mot_de_passe_hash)
                    if not mot_de_passe_hash.startswith("$2")
                    else mot_de_passe_hash
                ),
                actif=True,
            )
            session.add(utilisateur)
            await session.flush()
            return utilisateur


async def activer_desactiver_utilisateur(id_utilisateur: int, actif: bool) -> bool:
    if not _sessions:
        return False
    async with _sessions() as session:
        async with session.begin():
            resultat = await session.execute(
                text(
                    "UPDATE utilisateurs SET actif = :actif, modifie_le = now() "
                    "WHERE id_utilisateur = :id"
                ),
                {"id": id_utilisateur, "actif": actif},
            )
            return resultat.rowcount > 0


async def lister_patients() -> list[dict]:
    if not _sessions:
        return []
    async with _sessions() as session:
        resultat = await session.execute(
            text(
                "SELECT id_patient, code_patient, nom_complet, email, telephone, sexe, "
                "       annee_naissance, note, cree_le, nom, prenom, date_naissance "
                "FROM patients ORDER BY id_patient"
            )
        )
        return [
            {
                "id_patient": r[0],
                "code_patient": r[1],
                "nom_complet": r[2],
                "email": r[3],
                "telephone": r[4],
                "sexe": r[5],
                "annee_naissance": r[6],
                "note": r[7],
                "cree_le": _iso(r[8]),
                "nom": r[9],
                "prenom": r[10],
                "date_naissance": (r[11].isoformat() if r[11] is not None else None),
            }
            for r in resultat.all()
        ]


async def creer_patient(
    code_patient: str | None = None,
    nom_complet: str | None = None,
    email: str | None = None,
    telephone: str | None = None,
    sexe: str | None = None,
    annee_naissance: int | None = None,
    note: str | None = None,
    nom: str | None = None,
    prenom: str | None = None,
    date_naissance: date_naissance | None = None,
) -> Patient:
    """Cree un patient. Le code AER-AAAA-NNNN est genere si absent, le
    telephone stocke sous sa forme normalisee (index unique, dedoublonnage),
    et nom_complet reconstruit a partir de prenom + nom si fournis."""
    code = code_patient or await generer_code_patient()
    numero = normaliser_numero(telephone) if telephone else None
    nom_complet_final = nom_complet or " ".join(
        part for part in (prenom or None, nom or None) if part
    )
    async with _sessions() as session:
        async with session.begin():
            patient = Patient(
                code_patient=code,
                nom_complet=nom_complet_final or None,
                email=email,
                telephone=numero if numero else None,
                sexe=sexe,
                annee_naissance=annee_naissance,
                note=note,
                nom=nom or "",
                prenom=prenom or "",
                date_naissance=date_naissance,
            )
            session.add(patient)
            await session.flush()
            return patient


async def obtenir_patient_par_code(code_patient: str) -> Patient | None:
    if not _sessions:
        return None
    async with _sessions() as session:
        resultat = await session.execute(
            text("SELECT id_patient FROM patients WHERE code_patient = :code"),
            {"code": code_patient},
        )
        id_p = resultat.scalar()
        if id_p is None:
            return None
        return await session.get(Patient, id_p)


async def obtenir_patient_par_id(id_patient: int) -> Patient | None:
    if not _sessions:
        return None
    async with _sessions() as session:
        return await session.get(Patient, id_patient)


async def generer_code_patient() -> str:
    """Genere le prochain code patient au format AER-AAAA-NNNN.

    La sequence est extraite du suffixe numerique maximal des codes de
    l'annee courante (la colonne code_patient est UNIQUE : une eventuelle
    collision entre cliniciens concurrents est rejouee par la route).
    """
    annee = datetime.now(UTC).year
    prefixe = f"AER-{annee}-"
    suffixe_max = 0
    if _sessions is not None:
        async with _sessions() as session:
            resultat = await session.execute(
                text("SELECT code_patient FROM patients WHERE code_patient LIKE :prefix"),
                {"prefix": f"{prefixe}%"},
            )
            for (code,) in resultat.all():
                try:
                    suffixe_max = max(suffixe_max, int(code.rsplit("-", 1)[-1]))
                except ValueError:
                    continue
    return f"{prefixe}{suffixe_max + 1:04d}"


async def rechercher_patient_par_telephone(telephone: str) -> Patient | None:
    """Dedoublonne par numero WhatsApp normalise (index unique partiel).

    Le telephone est compare sous sa forme normalisee (chiffres + prefixe
    pays) : c'est la forme stockee a la creation, garantie unique par la
    migration 0004 (ux_patients_telephone).
    """
    if not _sessions:
        return None
    numero = normaliser_numero(telephone)
    if not numero:
        return None
    async with _sessions() as session:
        resultat = await session.execute(
            text(
                "SELECT id_patient FROM patients "
                "WHERE telephone = :numero AND telephone IS NOT NULL"
            ),
            {"numero": numero},
        )
        id_patient = resultat.scalar()
        if id_patient is None:
            return None
        return await session.get(Patient, id_patient)


async def rechercher_patient_par_email(email: str) -> Patient | None:
    """Retrouve un patient par email (index unique ux_patients_email).

    L'email est l'identifiant de contact le plus fiable du dossier : il doit
    donc etre verifie *avant* toute creation pour renvoyer un 409 explicite
    plutot que de laisser la contrainte unique lever une 500.
    """
    if not _sessions:
        return None
    adresse = email.strip().lower() if email else ""
    if not adresse:
        return None
    async with _sessions() as session:
        resultat = await session.execute(
            text("SELECT id_patient FROM patients WHERE email = :adresse"),
            {"adresse": adresse},
        )
        id_patient = resultat.scalar()
        if id_patient is None:
            return None
        return await session.get(Patient, id_patient)


# ---------------------------------------------------------------------------
# OTP
# ---------------------------------------------------------------------------

from app.otp import generer_otp, hacher_otp  # noqa: E402

# Un code OTP ne expire pas : le patient doit pouvoir consulter ses resultats
# autant de fois qu'il le souhaite, y compris des mois plus tard. La colonne
# `expire_le` reste NOT NULL en base (contrainte historique) et reçoit donc
# cette echeance lointaine plutot que NULL.
EXPIRE_LE_PERMANENT = datetime(2999, 12, 31, 23, 59, 59, tzinfo=UTC)


async def _creer_ligne_otp(
    id_patient: int,
    id_examen: int | None,
    destination: str,
) -> tuple[str, int]:
    """Insere un OTP et renvoie (code en clair, id_otp)."""
    code = generer_otp(config.otp_longueur)
    code_hash = hacher_otp(code)

    async with _sessions() as session:
        async with session.begin():
            otp = CodeOtp(
                id_patient=id_patient,
                id_examen=id_examen,
                email_destination=destination,
                code_hash=code_hash,
                expire_le=EXPIRE_LE_PERMANENT,
            )
            session.add(otp)
            await session.flush()
            return code, otp.id_otp


async def generer_et_stocker_otp(
    id_patient: int,
    id_examen: int | None,
    destination: str,
) -> str:
    """Genere un OTP, le stocke hashé en base, retourne le code en clair.

    ``destination`` est le contact qui recevra le code : adresse email OU
    numero WhatsApp (le champ SQL ``email_destination`` sert de destination
    generique pour les deux canaux).

    Le code est permanent (voir ``EXPIRE_LE_PERMANENT``) et reutilisable : il ne
    verifie que la propriete du contact saisi, pas une duree.

    Pour relier une decision clinique au code notifie, preferer
    ``emettre_otp_pour_examen`` qui rend aussi l'identifiant du code.
    """
    code, _ = await _creer_ligne_otp(id_patient, id_examen, destination)
    return code


async def emettre_otp_pour_examen(
    id_patient: int,
    id_examen: int,
    destination: str,
) -> tuple[str, int]:
    """Comme ``generer_et_stocker_otp`` mais rend (code, id_otp).

    L'identifiant du code est indispensable a la validation clinique : c'est lui
    que la ligne de validation reference, et donc celui que la desapprobation
    revoque ensuite.
    """
    return await _creer_ligne_otp(id_patient, id_examen, destination)


async def verifier_otp(code: str, destination: str) -> Patient | None:
    """Verifie un OTP defini par sa duree de validite.

    Le code est permanent et reutilisable : la seule condition de rejet est
    qu'il n'ait jamais ete emis, qu'il soit epuise (5 tentatives erronees),
    qu'il ait ete revoque par le clinicien (Vague 1) ou que le contact saisi
    ne soit pas celui du patient destinataire. Il n'existe volontairement
    aucun controle d'expiration ni d'usage unique : un compte rendu medical
    doit rester consultable autant de fois que le patient le souhaite, y
    compris apres un rechargement de page ou des mois plus tard.

    Le code est identifie par son empreinte (chaque code est unique) ; le
    contact saisi par le patient ne sert qu'a confirmer qu'il est bien le
    destinataire. Il doit correspondre a la destination stockee (le canal
    reellement notifie) OU a l'autre contact du patient (meme code envoye
    sur email ET WhatsApp, une seule destination stockee).
    Retourne le Patient associe si valide, None sinon.

    Apres un succes, ``utilise_le`` conserve la derniere consultation (tracabilite)
    et le compteur de tentatives est remis a zero.
    """
    from app.otp import hacher_otp as _hacher
    from app.whatsapp import normaliser_numero as _normaliser_numero

    code_hash = _hacher(code)

    async with _sessions() as session:
        async with session.begin():
            resultat = await session.execute(
                text(
                    "SELECT id_otp, id_patient, code_hash, expire_le, "
                    "       tentatives, utilise_le, email_destination, revoque_le "
                    "FROM otp_codes WHERE code_hash = :code_hash "
                    "ORDER BY id_otp DESC LIMIT 1"
                ),
                {"code_hash": code_hash},
            )
            ligne = resultat.first()
            if ligne is None:
                # Code inconnu : on borne malgre tout les tentatives sur ce
                # contact (meme comportement qu'une mauvaise saisie ciblee).
                await session.execute(
                    text(
                        "UPDATE otp_codes SET tentatives = tentatives + 1 "
                        "WHERE id_otp = (SELECT id_otp FROM otp_codes "
                        "WHERE email_destination = :destination "
                        "ORDER BY id_otp DESC LIMIT 1)"
                    ),
                    {"destination": destination},
                )
                return None

            (
                id_otp,
                id_patient,
                hash_db,
                expire_le,
                tentatives,
                utilise_le,
                email_dest,
                revoque_le,
            ) = ligne

            # Code revoque (Vague 1) : le clinicien a desapprove l'examen apres
            # l'envoi. Le code reste trace en base mais n'ouvre plus rien.
            if revoque_le is not None:
                return None

            # Trop de tentatives : seule cause de rejet liee a l'historique.
            # Le compteur est remis a zero des qu'un acces reussi a lieu.
            if tentatives >= _MAX_TENTATIVES_OTP:
                return None

            # Le contact saisi doit appartenir au patient destinataire
            patient = await session.get(Patient, id_patient)
            if patient is None:
                return None
            telephone_normalise = (
                _normaliser_numero(patient.telephone) if getattr(patient, "telephone", None) else ""
            )
            saisi = str(destination or "").strip().lower()
            contacts_patient = {
                str(email_dest or "").strip().lower(),
                str(patient.email or "").strip().lower(),
                str(telephone_normalise or "").strip(),
            }
            if saisi not in contacts_patient:
                await session.execute(
                    text("UPDATE otp_codes SET tentatives = tentatives + 1 WHERE id_otp = :id"),
                    {"id": id_otp},
                )
                return None

            # Acces valide : on trace la derniere consultation et on redonne
            # au patient son quota de tentatives.
            await session.execute(
                text(
                    "UPDATE otp_codes SET utilise_le = now(), tentatives = 0 " "WHERE id_otp = :id"
                ),
                {"id": id_otp},
            )

            return patient


async def obtenir_resultats_par_patient(id_patient: int) -> list[dict]:
    """Recupere le dernier examen **approuve** d'un patient (Vague 2).

    Un code OTP n'ouvre qu'un unique compte rendu, comme un etablissement de
    sante delivre le resultat d'une consultation : on ne renvoie donc ni le
    repertoire complet du patient, ni son dernier diagnostic quel qu'il soit.

    Le filtre est sur l'etat de validation, pas sur la date : un examen
    desapprouve ou jamais valide n'est pas un resultat clinique livrable, et le
    patient ne doit pas lire un compte rendu qu'un clinicien a refuse. La liste
    se fait par ordre decroissant, donc si un examen valide est rejette puis
    reapprouve plus tard, c'est bien lui qui ressort.

    Un patient dont aucun examen n'a ete approuve recoit une liste vide : c'est
    un etat legitime (« rien de valide a vous communiquer »), pas une panne.
    """
    if not _sessions:
        return []
    async with _sessions() as session:
        resultat = await session.execute(
            text(
                "SELECT d.id_diagnostic, d.execute_le, d.destination_choisie, "
                "       e.id_examen, e.nom_fichier, e.code_examen "
                "FROM diagnostics d "
                "JOIN examens_image e ON d.id_examen = e.id_examen "
                "JOIN v_etat_validation v ON v.id_examen = e.id_examen "
                "WHERE e.id_patient = :id_patient AND v.statut = 'approuve' "
                "ORDER BY d.id_diagnostic DESC LIMIT 1"
            ),
            {"id_patient": id_patient},
        )
        diagnostics = resultat.all()

        resultats = []
        for diag in diagnostics:
            id_diag = diag[0]
            resultats_patho = (
                await session.execute(
                    text(
                        "SELECT pathologie, prediction, confiance_finale, "
                        "       source_finale, temps_inference_ms "
                        "FROM resultats_pathologiques "
                        "WHERE id_diagnostic = :id ORDER BY rang"
                    ),
                    {"id": id_diag},
                )
            ).all()
            resultats.append(
                {
                    "id_diagnostic": id_diag,
                    "id_examen": diag[3],
                    "horodatage": _iso(diag[1]),
                    "destination": diag[2],
                    "nom_fichier": diag[4],
                    "code_examen": diag[5],
                    "validation": await etat_validation(diag[3]),
                    "resultats": [
                        {
                            "pathologie": r[0],
                            "prediction": r[1],
                            "confiance": float(r[2]),
                            "source": r[3],
                            "temps_inference_ms": float(r[4]),
                        }
                        for r in resultats_patho
                    ],
                }
            )

    return resultats


# ---------------------------------------------------------------------------
# Vague 1 : dossier clinique du patient, suivi et validation
# ---------------------------------------------------------------------------

# Verdicts livres au clinicien : colonnes cliniques uniquement. Ni destination
# Edge/Cloud, ni latence, ni identifiant systeme — la page Historique reste le
# journal technique (separation des roles).
_VERDITS_CLINIQUES_SQL = """
    SELECT rp.id_diagnostic, rp.pathologie, rp.prediction,
           rp.confiance_finale, rp.determinant
    FROM resultats_pathologiques rp
    WHERE rp.id_diagnostic IN :ids
    ORDER BY rp.id_diagnostic, rp.rang
""".strip()

_VERDITS_CLINIQUES = text(_VERDITS_CLINIQUES_SQL).bindparams(bindparam("ids", expanding=True))


async def _verdits_par_diagnostic(ids: list[int]) -> dict[int, list[dict]]:
    """Regroupe les verdicts cliniques par diagnostic (une seule requete)."""
    if not _sessions or not ids:
        return {}
    async with _sessions() as session:
        lignes = (await session.execute(_VERDITS_CLINIQUES, {"ids": list(ids)})).all()
    groupes: dict[int, list[dict]] = {}
    for id_diag, pathologie, prediction, confiance, determinant in lignes:
        groupes.setdefault(id_diag, []).append(
            {
                "pathologie": pathologie,
                "prediction": prediction,
                "confiance": float(confiance),
                "determinant": bool(determinant),
            }
        )
    return groupes


async def patient_de_examen(id_examen: int) -> int | None:
    """Patient rattache a un examen, None si l'examen n'existe pas (Vague 1)."""
    if not _sessions:
        return None
    async with _sessions() as session:
        resultat = await session.execute(
            text("SELECT id_patient FROM examens_image WHERE id_examen = :id"),
            {"id": id_examen},
        )
        identifiant = resultat.scalar()
    return int(identifiant) if identifiant is not None else None


async def etat_validation(id_examen: int) -> dict:
    """Etat courant de validation d'un examen (Vague 1).

    L'absence de ligne vaut « sans decision » : on ne pre-cree surtout pas une
    validation pour les 1000+ diagnostics deja en base, ce qui reviendrait a
    fabriquer une tracabilite clinique qui n'a jamais existe.
    """
    if not _sessions:
        return {"statut": "sans_base"}
    async with _sessions() as session:
        ligne = (
            await session.execute(
                text(
                    "SELECT v.id_validation, v.statut, v.note_clinique, "
                    "       v.motif_desaccord, v.cree_le, u.email "
                    "FROM validations_cliniques v "
                    "LEFT JOIN utilisateurs u ON u.id_utilisateur = v.id_utilisateur "
                    "WHERE v.id_examen = :id "
                    "ORDER BY v.id_validation DESC LIMIT 1"
                ),
                {"id": id_examen},
            )
        ).first()
    if ligne is None:
        return {"statut": "sans_decision"}
    return {
        "id_validation": ligne[0],
        "statut": ligne[1],
        "note_clinique": ligne[2],
        "motif_desaccord": ligne[3],
        "horodatage": _iso(ligne[4]),
        "par": ligne[5],
    }


async def lister_dossiers_cliniques() -> list[dict]:
    """Dossiers patients vus par le clinicien (page /patients).

    Chaque ligne porte le nombre d'examens, le dernier verdict et la
    validation en cours, pour orienter la priorite sans passer par le journal
    technique. Tri : dossiers ayant un examen le plus recent d'abord.
    """
    if not _sessions:
        return []
    async with _sessions() as session:
        entetes = (
            await session.execute(
                text(
                    "SELECT p.id_patient, p.code_patient, p.nom_complet, p.sexe, "
                    "       p.annee_naissance, p.telephone, COUNT(DISTINCT e.id_examen) "
                    "FROM patients p "
                    "LEFT JOIN examens_image e ON e.id_patient = p.id_patient "
                    "GROUP BY p.id_patient "
                    "ORDER BY p.code_patient"
                )
            )
        ).all()

        # Dernier diagnostic de chaque patient, en une passe (DISTINCT ON).
        derniers = (
            await session.execute(
                text(
                    "SELECT DISTINCT ON (e.id_patient) e.id_patient, d.id_diagnostic, "
                    "       d.execute_le, d.id_examen "
                    "FROM examens_image e JOIN diagnostics d ON d.id_examen = e.id_examen "
                    "ORDER BY e.id_patient, d.id_diagnostic DESC"
                )
            )
        ).all()
        par_patient = {r[0]: r for r in derniers}
        verdits = await _verdits_par_diagnostic([r[1] for r in derniers])

    dossiers = []
    for id_patient, code, nom_complet, sexe, annee, telephone, nb_examens in entetes:
        dernier = par_patient.get(id_patient)
        verdict = None
        validation = {"statut": "sans_decision"}
        if dernier is not None:
            verdicts = verdits.get(dernier[1], [])
            positifs = [v for v in verdicts if v["prediction"] == "positif"]
            # Un seul verdict est monte : la pathologie la plus determinante
            # (confiance la plus forte) parmi les positifs, sinon le 1er rang.
            if positifs:
                verdict = max(positifs, key=lambda v: v["confiance"])
            elif verdicts:
                verdict = verdicts[0]
            validation = await etat_validation(dernier[3])
        dossiers.append(
            {
                "id_patient": id_patient,
                "code_patient": code,
                "nom_complet": nom_complet,
                "sexe": sexe,
                "annee_naissance": annee,
                "telephone": telephone,
                "nb_examens": int(nb_examens),
                "dernier_examen_le": _iso(dernier[2]) if dernier else None,
                "dernier_verdict": verdict,
                "validation": validation,
            }
        )

    dossiers.sort(
        key=lambda d: (d["dernier_examen_le"] is None, d["dernier_examen_le"] or ""),
        reverse=True,
    )
    return dossiers


async def chronologie_patient(id_patient: int) -> dict | None:
    """Chronologie clinique d'un patient : tous ses examens, du plus recent au
    plus ancien, verdicts et etat de validation inclus.

    Alimente la fiche /patients et la comparaison « dernier examen » contre
    « precedent » demandee pour visualiser une evolution.
    """
    if not _sessions:
        return None
    async with _sessions() as session:
        entete = (
            await session.execute(
                text(
                    "SELECT id_patient, code_patient, nom_complet, sexe, "
                    "       annee_naissance, telephone, email, note "
                    "FROM patients WHERE id_patient = :id"
                ),
                {"id": id_patient},
            )
        ).first()
        if entete is None:
            return None

        diagnostics = (
            await session.execute(
                text(
                    "SELECT d.id_diagnostic, d.id_examen, d.execute_le, "
                    "       e.code_examen, e.nom_fichier "
                    "FROM diagnostics d JOIN examens_image e ON d.id_examen = e.id_examen "
                    "WHERE e.id_patient = :id "
                    "ORDER BY d.id_diagnostic DESC"
                ),
                {"id": id_patient},
            )
        ).all()
        verdicts = await _verdits_par_diagnostic([r[0] for r in diagnostics])

    # Un meme examen peut avoir plusieurs diagnostics (reanalyse) : on ne garde
    # que le plus recent, sans quoi la chronologie compterait des doublons.
    par_examen: dict[int, dict] = {}
    for id_diag, id_examen, execute_le, code_examen, nom_fichier in diagnostics:
        if id_examen in par_examen:
            continue
        par_examen[id_examen] = {
            "id_examen": id_examen,
            "code_examen": code_examen,
            "nom_fichier": nom_fichier,
            "horodatage": _iso(execute_le),
            "resultats": verdicts.get(id_diag, []),
            "validation": await etat_validation(id_examen),
        }

    return {
        "id_patient": entete[0],
        "code_patient": entete[1],
        "nom_complet": entete[2],
        "sexe": entete[3],
        "annee_naissance": entete[4],
        "telephone": entete[5],
        "email": entete[6],
        "note": entete[7],
        "examens": list(par_examen.values()),
    }


async def lister_suivis(limite: int = 200) -> list[dict]:
    """Controles a venir, de l'echeance la plus proche a la plus lointaine.

    Les suivis honnis ou annules restent visibles mais sortent du triage
    clinique : ils passent en fin de liste plutot que d'etre caches, pour que
    l'historique du poste reste lisible.
    """
    if not _sessions:
        return []
    async with _sessions() as session:
        lignes = (
            await session.execute(
                text(
                    "SELECT s.id_suivi, s.id_patient, p.code_patient, p.nom_complet, "
                    "       s.id_examen_origine, e.code_examen, s.date_suivi, "
                    "       s.motif, s.statut, s.cree_le "
                    "FROM suivis_cliniques s "
                    "JOIN patients p ON p.id_patient = s.id_patient "
                    "LEFT JOIN examens_image e ON e.id_examen = s.id_examen_origine "
                    "ORDER BY (s.statut <> 'planifie'), s.date_suivi, p.code_patient "
                    "LIMIT :limite"
                ),
                {"limite": limite},
            )
        ).all()
    return [
        {
            "id_suivi": r[0],
            "id_patient": r[1],
            "code_patient": r[2],
            "nom_complet": r[3],
            "id_examen_origine": r[4],
            "code_examen": r[5],
            "date_suivi": r[6].isoformat() if r[6] else None,
            "motif": r[7],
            "statut": r[8],
            "cree_le": _iso(r[9]),
        }
        for r in lignes
    ]


async def creer_suivi(
    id_patient: int,
    date_suivi: date_naissance,
    motif: str | None = None,
    id_examen_origine: int | None = None,
) -> dict:
    """Programme un controle a venir pour un patient.

    ``statut`` n'est pas parametrable : un suivi naits toujours « planifie ».
    Les transitions (``realise``, ``annule``) passent par
    ``changer_statut_suivi``, qui est le seul a reecrire la colonne.
    """
    if not _sessions:
        raise SQLAlchemyError("Base de donnees indisponible")
    async with _sessions() as session:
        async with session.begin():
            suivi = SuiviClinique(
                id_patient=id_patient,
                id_examen_origine=id_examen_origine,
                date_suivi=date_suivi,
                motif=motif,
                statut="planifie",
            )
            session.add(suivi)
            await session.flush()
            # L'objet cree est renvoye au complet, et non un simple
            # {id_suivi, statut} : le front affiche « controle programme le
            # <date> — <motif » juste apres l'enregistrement, et lisait donc
            # date_suivi et motif. Un retour partiel produisait « Invalid Date »
            # et effacait silencieusement le motif.
            return {
                "id_suivi": suivi.id_suivi,
                "id_patient": suivi.id_patient,
                "id_examen_origine": suivi.id_examen_origine,
                "date_suivi": suivi.date_suivi.isoformat() if suivi.date_suivi else None,
                "motif": suivi.motif,
                "statut": suivi.statut,
                "cree_le": _iso(suivi.cree_le) if suivi.cree_le else None,
            }


async def changer_statut_suivi(id_suivi: int, statut: str) -> bool:
    """Passe un suivi en realise ou annule (le triage ne liste que les
    echeances honorees ; rien n'est supprime pour garder la trace)."""
    if not _sessions:
        return False
    async with _sessions() as session:
        async with session.begin():
            resultat = await session.execute(
                text("UPDATE suivis_cliniques SET statut = :statut WHERE id_suivi = :id"),
                {"statut": statut, "id": id_suivi},
            )
            return resultat.rowcount > 0


async def lister_file_triage(seuil_alerte_jours: int = 2) -> dict:
    """File de triage : tous les examens completed en attente de validation.

    Un examen entre dans la file tant qu'aucune decision clinique n'a ete
    journalisee pour lui. L'absence de ligne vaut « a valider » — les ~1 000
    diagnostics anterieurs sont donc visibles des la premiere ouverture, ce
    qui est le but d'une file de triage, et ne sont pas retro-validates.

    Un examen peut avoir plusieurs diagnostics (reanalyse) : seul le plus
    recent compte, sinon la file compterait des doublons. Seuls les verdicts
    sont exposes, pas la destination Edge/Cloud ni les latences : la file est
    un outil de poste de travail, le journal technique reste ailleurs.

    Le tri est par attente croissante : ce qui attend depuis le plus longtemps
    passe en premier. Une analyse echouee n'a aucun verdict a valider, elle
    n'entre donc pas dans la file.

    Les alertes ne sont pas stockees : elles sont derivees du delai a l'instant
    de la lecture. Rien n'est ecrit dans la base par une simple consultation.
    """
    if not _sessions:
        return {"seuil_alerte_jours": seuil_alerte_jours, "examens": [], "alertes": []}

    async with _sessions() as session:
        # Dernier diagnostic complete par examen, tous patients confondus.
        lignes = (
            await session.execute(
                text(
                    "SELECT DISTINCT ON (d.id_examen) d.id_examen, d.id_diagnostic, "
                    "       d.execute_le, e.id_patient, p.code_patient, p.nom_complet, "
                    "       p.sexe, p.annee_naissance, e.code_examen, e.nom_fichier, "
                    "       p.telephone, p.email "
                    "FROM diagnostics d "
                    "JOIN examens_image e ON e.id_examen = d.id_examen "
                    "JOIN patients p ON p.id_patient = e.id_patient "
                    "WHERE d.statut = 'completed' "
                    "ORDER BY d.id_examen, d.id_diagnostic DESC"
                )
            )
        ).all()

        # Un seul passage pour tous les etats de validation : la vue fait deja
        # le DISTINCT ON, on evite un etat_validation() par ligne du triage.
        etats = (
            await session.execute(text("SELECT id_examen, statut FROM v_etat_validation"))
        ).all()
        valide = {r[0] for r in etats if r[1] == "approuve"}
        {r[0] for r in etats if r[1] == "desapprouve"}
        {r[0] for r in etats}

    verdicts = await _verdits_par_diagnostic([r[1] for r in lignes])

    now = datetime.now(UTC)
    examens = []
    for (
        id_examen,
        id_diagnostic,
        execute_le,
        id_patient,
        code_patient,
        nom_complet,
        sexe,
        annee_naissance,
        code_examen,
        nom_fichier,
        telephone,
        email,
    ) in lignes:
        if id_examen in valide:
            continue
        verds = verdicts.get(id_diagnostic, [])
        positifs = [v for v in verds if v["prediction"] == "positif"]
        verdict = max(positifs, key=lambda v: v["confiance"]) if positifs else None
        # Age en jours entiers : un examen fait il y a 6 h compte pour 0 jour,
        # ce qui evite d'alerter sur un examen de la journee en cours.
        age = now - execute_le
        jours = age.days
        examens.append(
            {
                "id_examen": id_examen,
                "id_diagnostic": id_diagnostic,
                "id_patient": id_patient,
                "code_patient": code_patient,
                "nom_complet": nom_complet,
                "sexe": sexe,
                "annee_naissance": annee_naissance,
                "code_examen": code_examen,
                "nom_fichier": nom_fichier,
                # Une approbation emet un OTP au patient : sans telephone ni
                # email, la decision est refusee par l'API. Le dire dans la
                # file evite au clinicien de decouvrir l'echec apres le clic.
                "contact_disponible": bool(telephone or email),
                "horodatage": _iso(execute_le),
                "resultats": verds,
                "verdict_principal": verdict,
                "validation": await etat_validation(id_examen),
                "jours_attente": jours,
                "alerte": jours >= seuil_alerte_jours,
            }
        )

    # Attente decroissante : le plus ancien d'abord, c'est lui qui sort en
    # premier du poste. A egalite d'age, code patient pour un ordre stable
    # entre deux appels.
    examens.sort(key=lambda e: (-e["jours_attente"], e["code_patient"]))
    return {
        "seuil_alerte_jours": seuil_alerte_jours,
        "examens": examens,
        "alertes": [e for e in examens if e["alerte"]],
    }


async def enregistrer_validation(
    id_examen: int,
    statut: str,
    id_utilisateur: int | None = None,
    note_clinique: str | None = None,
    motif_desaccord: str | None = None,
    id_otp: int | None = None,
) -> dict:
    """Journalise une decision du clinicien sur un examen (Vague 1).

    En ajout et jamais en ecrasement : un desaccord puis une reapprobation
    conservent chacun leur motif, l'etat courant se lisant dans
    v_etat_validation. ``id_otp`` relie la decision au code notifie au patient,
    ce qui permet de le revoquer lors d'un desaccord.
    """
    if not _sessions:
        raise SQLAlchemyError("Base de donnees indisponible")
    async with _sessions() as session:
        async with session.begin():
            validation = ValidationClinique(
                id_examen=id_examen,
                id_utilisateur=id_utilisateur,
                id_otp=id_otp,
                statut=statut,
                note_clinique=note_clinique,
                motif_desaccord=motif_desaccord,
            )
            session.add(validation)
            await session.flush()
            return {
                "id_validation": validation.id_validation,
                "id_examen": id_examen,
                "statut": statut,
                "cree_le": _iso(validation.cree_le),
            }


async def revoquer_otp(id_examen: int) -> int:
    """Retire au patient l'acces aux codes emis pour cet examen.

    Les lignes sont conservees (trace de ce qui a ete notifie) ; seule la
    date de revocation est posee, et verifier_otp refuse desormais le code.
    """
    if not _sessions:
        return 0
    async with _sessions() as session:
        async with session.begin():
            resultat = await session.execute(
                text(
                    "UPDATE otp_codes SET revoque_le = now() "
                    "WHERE id_examen = :id AND revoque_le IS NULL"
                ),
                {"id": id_examen},
            )
            return resultat.rowcount


# ---------------------------------------------------------------------------
# Alimentation (non bloquant) et worker
# ---------------------------------------------------------------------------


def soumettre_diagnostic(diagnostic: dict) -> None:
    """Dépose un diagnostic dans la file d'attente (jamais bloquant)."""
    if not _persistance_active:
        return
    _file_attente.append(diagnostic)


def enregistrer_observations_telemetrie(observations: list[dict]) -> None:
    """File les observations télémétriques (cpu, ram, latence…)."""
    if not _persistance_active:
        return
    _file_attente.append({"_type": "telemetrie", "observations": observations})


def _rejeter_ou_requeuer(elements: list[dict]) -> None:
    """Rejoue les éléments échoués tant qu'ils n'ont pas épuisé leurs essais.

    Un lot qui échoue pour une raison passagère (base injoignable) est rejoué ;
    un élément définitivement invalide (contraintes, données) est abandonné
    après ``MAX_TENTATIVES_PERSISTANCE`` essais pour éviter une boucle infinie.
    """
    for element in elements:
        tentatives = int(element.get("_tentatives", 0)) + 1
        if tentatives <= MAX_TENTATIVES_PERSISTANCE:
            element["_tentatives"] = tentatives
            _file_attente.appendleft(element)
        else:
            _logger.warning(
                "Persistance abandonnée après %d tentatives : %s",
                tentatives,
                element.get("nom_fichier", "<télémétrie>"),
            )


async def _boucle_persistance() -> None:
    """Worker : fl ushe la file par lots à intervalle régulier.

    En cas d'échec (base momentanément injoignable) les éléments restent en
    tête de file et sont rejoués au cycle suivant : aucune perte silencieuse.
    """
    while True:
        await asyncio.sleep(config.persistance_interval_seconde)
        if not _persistance_active and not _file_attente:
            break
        if not _file_attente:
            continue
        elements = []
        while _file_attente:
            elements.append(_file_attente.popleft())
        try:
            await _ecrire_lots(elements)
        except Exception as exc:  # noqa: BLE001 - toute erreur DB → retry borné
            _logger.error("Écriture persistante échouée (%s) — réessai", exc)
            _rejeter_ou_requeuer(elements)


async def _flush_si_attente() -> None:
    """Dernier flush bloquant avant arrêt."""
    if not _file_attente:
        return
    elements = []
    while _file_attente:
        elements.append(_file_attente.popleft())
    try:
        await _ecrire_lots(elements)
    except Exception as exc:  # noqa: BLE001 - l'arrêt ne doit pas planter
        _logger.error("Dernier flush échoué à l'arrêt : %s", exc)
        _rejeter_ou_requeuer(elements)


# ---------------------------------------------------------------------------
# Écriture en base
# ---------------------------------------------------------------------------


async def _ecrire_lots(elements: list[dict]) -> None:
    telemetrie = [e for e in elements if e.get("_type") == "telemetrie"]
    diagnostics = [e for e in elements if e.get("_type") != "telemetrie"]
    for lot in telemetrie:
        await _ecrire_telemetrie(lot["observations"])
    if diagnostics:
        await _ecrire_diagnostics(diagnostics)


async def _ecrire_telemetrie(observations: list[dict]) -> None:
    async with _sessions() as session:
        async with session.begin():
            for obs in observations:
                await session.execute(
                    text(
                        "INSERT INTO telemetrie_observations "
                        "(horodatage, departement, conteneur, nom_mesure, valeur, unite) "
                        "VALUES (now(), :departement, :conteneur, :nom, :valeur, :unite)"
                    ),
                    {
                        "departement": obs["departement"],
                        "conteneur": obs.get("conteneur"),
                        "nom": obs["nom_mesure"],
                        "valeur": obs["valeur"],
                        "unite": obs.get("unite"),
                    },
                )


async def _ecrire_diagnostics(items: list[dict]) -> None:
    async with _sessions() as session:
        async with session.begin():
            id_version = await _obtenir_version_courante(session)

            for element in items:
                # id_patient du sujet réel (code_patient transmis à l'analyse)
                # si présent dans le lot ; sinon, repli sur le patient
                # technique anonyme par défaut.
                id_patient = element.get("id_patient") or await _obtenir_patient_par_defaut(session)
                # Examen deja prepare par la route (Vague 1) : on le reutilise
                # tel quel. Sinon on retombe sur la creation asynchrone d'origine.
                id_examen = element.get("id_examen") or await _obtenir_ou_creer_examen(
                    session, element, id_patient
                )
                diagnostic = Diagnostic(
                    id_examen=id_examen,
                    id_version_configuration=id_version,
                    contexte_depistage=element.get("contexte", "auto"),
                    destination_choisie=element["destination"],
                    raison_decision=element["raison"],
                    cpu_pourcentage=_chiffre(element.get("metriques"), "cpu_pourcentage"),
                    ram_pourcentage=_chiffre(element.get("metriques"), "ram_pourcentage"),
                    latence_reseau_ms=_chiffre(element.get("metriques"), "latence_reseau_ms"),
                    reseau_disponible=_bool(element.get("metriques"), "reseau_disponible"),
                    temps_total_ms=float(element.get("temps_total_ms", 0.0)),
                    temps_escalade_ms=(
                        float(element["temps_escalade_ms"])
                        if element.get("temps_escalade_ms")
                        else None
                    ),
                    statut=element.get("statut", "completed"),
                )
                session.add(diagnostic)
                await session.flush()  # alloue id_diagnostic

                filtrage = element.get("filtrage")
                if filtrage:
                    session.add(_construire_profil(filtrage, diagnostic.id_diagnostic))

                # Résolution du modèle réellement exécuté (pathologie × source) :
                # alimente v_performance_modeles sans interpolation client.
                ids_modeles: dict[tuple[str, str], int | None] = {}
                for rang, resultat in enumerate(element.get("resultats", []), start=1):
                    cle = (resultat.get("pathologie", ""), resultat.get("source", "edge"))
                    if cle not in ids_modeles:
                        ids_modeles[cle] = await _obtenir_id_modele(session, *cle)
                    session.add(
                        _construire_resultat(
                            resultat, diagnostic.id_diagnostic, rang, ids_modeles[cle]
                        )
                    )

                for escalade in element.get("escalades", []):
                    session.add(_construire_escalade(escalade, diagnostic.id_diagnostic))


async def _obtenir_patient_par_defaut(session: AsyncSession) -> int:
    """Patient technique anonyme unique (l'API ne transmet pas encore de sujet)."""
    resultat = await session.execute(
        text("SELECT id_patient FROM patients WHERE code_patient = :code"),
        {"code": CODE_PATIENT_DEFAUT},
    )
    identifiant = resultat.scalar()
    if identifiant is not None:
        return identifiant
    patient = Patient(
        code_patient=CODE_PATIENT_DEFAUT,
        note="Sujet anonyme technique de démonstration",
    )
    session.add(patient)
    await session.flush()  # alloue id_patient
    return patient.id_patient


async def _obtenir_version_courante(session: AsyncSession) -> int | None:
    resultat = await session.execute(
        text(
            "SELECT id_version FROM versions_configuration "
            "WHERE active_jusqu_a IS NULL ORDER BY id_version LIMIT 1"
        )
    )
    return resultat.scalar()


async def _obtenir_id_modele(
    session: AsyncSession, pathologie: str, environnement: str
) -> int | None:
    """Identifie le modèle du référentiel réellement exécuté.

    C'est ce rattachement (pathologie × source) qui alimente
    ``v_performance_modeles`` : chaque verdict est attribué à la version de
    modèle qui tournait sur la source d'exécution.
    """
    resultat = await session.execute(
        text(
            "SELECT id_modele FROM modeles_ia "
            "WHERE pathologie = :pathologie AND environnement = :environnement "
            "AND actif ORDER BY id_modele LIMIT 1"
        ),
        {"pathologie": pathologie, "environnement": environnement},
    )
    return resultat.scalar()


async def preparer_examen(
    id_patient: int | None,
    nom_fichier: str,
    hash_contenu: str,
    taille_octets: int,
) -> int | None:
    """Cree (ou retrouve) l'examen et renvoie son identifiant, sans bloquer.

    Pourquoi une ecriture synchrone ici alors que le reste de la persistance
    est asynchrone (Vague 1) : l'approbation clinique s'adresse a un examen
    precis, et le clinicien decide quelques secondes apres l'analyse. Or
    l'identifiant d'examen etait alloue par le worker, donc inconnu au moment
    ou la route repondait — il fallait un identifiant immediatement
    exploitable. Seule la ligne d'examen est ecrite ici (un SELECT de
    deduplication + un INSERT) ; diagnostics, verdicts et profils restent
    flushes par le worker.

    Regle de non-bloquage preservee : toute erreur est absorbee et None
    renvoye. La reponse d'inference part toujours, et l'approbation signalera
    alors « examen introuvable » au lieu d'approuver la mauvaise cible.
    """
    if not _sessions:
        return None
    try:
        async with _sessions() as session:
            async with session.begin():
                cible = id_patient or await _obtenir_patient_par_defaut(session)
                return await _obtenir_ou_creer_examen(
                    session,
                    {
                        "nom_fichier": nom_fichier,
                        "hash_contenu": hash_contenu,
                        "taille_octets": taille_octets,
                    },
                    cible,
                )
    except SQLAlchemyError as exc:
        _logger.warning("Examen non prepare (%s) : analyse servie sans persistance", exc)
        return None


async def _obtenir_ou_creer_examen(session: AsyncSession, element: dict, id_patient: int) -> int:
    """Dédoublonne par empreinte SHA-256 du contenu."""
    hash_contenu = element.get("hash_contenu") or _hacher_contenu(element.get("contenu", b""))
    resultat = await session.execute(
        text("SELECT id_examen FROM examens_image WHERE hash_contenu = :hash"),
        {"hash": hash_contenu},
    )
    identifiant = resultat.scalar()
    if identifiant is not None:
        # Un examen déjà présent (même empreinte) peut avoir été créé sans
        # connaitre le sujet réel (patient technique) : on le rattache au
        # patient déclaré par le code_patient afin que ses résultats lui
        # soient restitués via le flux OTP.
        ligne = await session.execute(
            text("SELECT id_patient FROM examens_image WHERE id_examen = :id"),
            {"id": identifiant},
        )
        if ligne.scalar() != id_patient:
            await session.execute(
                text("UPDATE examens_image SET id_patient = :p " "WHERE id_examen = :id"),
                {"p": id_patient, "id": identifiant},
            )
        return identifiant
    examen = ExamenImage(
        id_patient=id_patient,
        code_examen=f"{CODE_EXAMEN_PREFIXE}-{datetime.now().microsecond}",
        nom_fichier=element.get("nom_fichier", "inconnu"),
        format_fichier=None,
        taille_octets=int(element.get("taille_octets", 0)),
        hash_contenu=hash_contenu,
    )
    session.add(examen)
    await session.flush()  # alloue id_examen
    return examen.id_examen


def _construire_profil(filtrage: dict, id_diagnostic: int) -> ProfilImageAnalyse:
    profil = filtrage.get("profil", {}) or {}
    return ProfilImageAnalyse(
        id_diagnostic=id_diagnostic,
        format_image=profil.get("format"),
        largeur_px=profil.get("largeur_px"),
        hauteur_px=profil.get("hauteur_px"),
        ratio_largeur_hauteur=profil.get("ratio_largeur_hauteur"),
        mode_canaux=profil.get("mode_canaux"),
        taille_octets=profil.get("taille_octets"),
        indecodable=bool(profil.get("indecodable", False)),
        specialistes_admissibles=filtrage.get("specialistes_admissibles") or [],
        cle_regle=filtrage.get("cle_regle"),
        regle_appliquee=filtrage.get("regle_appliquee"),
        specialiste_ecarte=filtrage.get("specialiste_ecarte"),
        raison=filtrage.get("raison"),
    )


def _construire_resultat(
    resultat: dict, id_diagnostic: int, rang: int, id_modele: int | None = None
) -> ResultatPathologique:
    pathologie = resultat["pathologie"]
    source_finale = resultat.get("source", "edge")
    return ResultatPathologique(
        id_diagnostic=id_diagnostic,
        id_modele=id_modele,
        pathologie=pathologie,
        prediction=resultat["prediction"],
        confiance_finale=float(resultat["confiance"]),
        confiance_initiale=_opt(resultat, "confiance_initiale"),
        source_finale=source_finale,
        source_initiale=resultat.get("source_initiale"),
        determinant=not resultat.get("indetermine", False),
        temps_inference_ms=float(resultat.get("temps_inference_ms", 0.0)),
        rang=rang,
    )


def _construire_escalade(escalade: dict, id_diagnostic: int) -> EscaladeControle:
    return EscaladeControle(
        id_diagnostic=id_diagnostic,
        pathologie=escalade["pathologie"],
        source_initiale=escalade["source_initiale"],
        confiance_initiale=float(escalade["confiance_initiale"]),
        source_controle=escalade["source_controle"],
        confiance_controle=float(escalade["confiance_controle"]),
        decision=escalade["decision"],
        raison=escalade.get("raison"),
    )


def _chiffre(mapping: dict | None, cle: str) -> float | None:
    valeur = (mapping or {}).get(cle)
    return float(valeur) if valeur is not None else None


def _bool(mapping: dict | None, cle: str) -> bool | None:
    valeur = (mapping or {}).get(cle)
    return bool(valeur) if valeur is not None else None


def _opt(mapping: dict, cle: str) -> float | None:
    valeur = mapping.get(cle)
    return float(valeur) if valeur is not None else None


# ---------------------------------------------------------------------------
# Réhydratation du registre mémoire au démarrage
# ---------------------------------------------------------------------------


async def recuperer_diagnostics_recents(limite: int) -> list[dict] | None:
    """Journal durable des ``limite`` derniers diagnostics, du plus recent au plus ancien.

    Le registre mémoire est une fenetre circulaire de 100 entrees : un scenario
    de charge l'epaissit en quelques minutes et masque alors tout l'historique
    anterieur, meme completement persiste. Cette lecture SQL contourne la
    fenetre et rend le journal durable — c'est la source de verite de la page
    « Historique ».

    Retourne ``None`` si PostgreSQL est indisponible ou non initialise : les
    appelants se rabattent alors sur la fenetre memoire plutot que d'echouer.
    """
    if not active() or _sessions is None:
        return None

    try:
        async with _sessions() as session:
            lignes = (
                await session.execute(
                    text(
                        "SELECT id_diagnostic, execute_le, destination_choisie, statut, "
                        "       temps_total_ms, contexte_depistage "
                        "FROM diagnostics ORDER BY id_diagnostic DESC LIMIT :limite"
                    ),
                    {"limite": limite},
                )
            ).all()
            if not lignes:
                return []

            identifiants = [ligne[0] for ligne in lignes]
            resultats = (
                await session.execute(
                    text(
                        "SELECT id_diagnostic, pathologie, prediction, confiance_finale, "
                        "       temps_inference_ms, source_finale, confiance_initiale, "
                        "       source_initiale, determinant "
                        "FROM resultats_pathologiques WHERE id_diagnostic = ANY(:ids) "
                        "ORDER BY id_diagnostic, rang"
                    ),
                    {"ids": identifiants},
                )
            ).all()
            escalades = (
                await session.execute(
                    text(
                        "SELECT id_diagnostic, pathologie, source_initiale, "
                        "       confiance_initiale, source_controle, confiance_controle, "
                        "       decision, raison "
                        "FROM escalades_controle WHERE id_diagnostic = ANY(:ids) "
                        "ORDER BY id_diagnostic"
                    ),
                    {"ids": identifiants},
                )
            ).all()
    except SQLAlchemyError as erreur:  # pragma: no cover - degrade gracieux
        _logger.warning("Journal durable illisible, repli sur le registre memoire : %s", erreur)
        return None

    resultats_par_diagnostic: dict[int, list[tuple]] = {}
    for ligne in resultats:
        resultats_par_diagnostic.setdefault(ligne[0], []).append(ligne[1:])
    escalades_par_diagnostic: dict[int, list[tuple]] = {}
    for ligne in escalades:
        escalades_par_diagnostic.setdefault(ligne[0], []).append(ligne[1:])

    return [
        {
            "id": identifiant,
            "horodatage": _iso(horodatage),
            "destination": destination,
            "resultats": [
                {
                    "pathologie": r[0],
                    "prediction": r[1],
                    "confiance": float(r[2]),
                    "temps_inference_ms": float(r[3]),
                    "source": r[4],
                    "confiance_initiale": _opt_v(r[5]),
                    "source_initiale": r[6],
                    "indetermine": not bool(r[7]),
                }
                for r in resultats_par_diagnostic.get(identifiant, [])
            ],
            "escalades": [
                {
                    "pathologie": e[0],
                    "source_initiale": e[1],
                    "confiance_initiale": float(e[2]),
                    "source_controle": e[3],
                    "confiance_controle": float(e[4]),
                    "decision": e[5],
                    "raison": e[6],
                }
                for e in escalades_par_diagnostic.get(identifiant, [])
            ],
            "temps_total_ms": round(float(temps_total), 1),
            "statut": statut,
            "contexte": contexte,
        }
        for identifiant, horodatage, destination, statut, temps_total, contexte in lignes
    ]


async def statistiques_durables() -> dict | None:
    """Statistiques cumulées sur l'ensemble du journal persistant.

    Miroir SQL de ``registre_diagnostics.statistiques()``, mais calculé sur
    toutes les lignes et non sur la fenetre memoire de 100 entrees. Ainsi le
    compteur « Inferences totales » designe la realite stockee, et non la
    taille de la fenetre.
    """
    if not active() or _sessions is None:
        return None
    try:
        async with _sessions() as session:
            ligne = (
                await session.execute(
                    text(
                        "SELECT COUNT(*), "
                        "       COUNT(*) FILTER (WHERE statut = 'completed'), "
                        "       COUNT(*) FILTER (WHERE destination_choisie = 'edge'), "
                        "       COUNT(*) FILTER (WHERE destination_choisie = 'cloud'), "
                        "       COALESCE(AVG(temps_total_ms) FILTER "
                        "           (WHERE destination_choisie = 'edge'), 0), "
                        "       COALESCE(AVG(temps_total_ms) FILTER "
                        "           (WHERE destination_choisie = 'cloud'), 0) "
                        "FROM diagnostics"
                    )
                )
            ).one()
    except SQLAlchemyError as erreur:  # pragma: no cover - degrade gracieux
        _logger.warning("Statistiques durables illisibles, repli sur la fenetre : %s", erreur)
        return None

    total = int(ligne[0] or 0)
    edge = int(ligne[2] or 0)
    cloud = int(ligne[3] or 0)
    return {
        "total": total,
        "taux_reussite": round(int(ligne[1] or 0) / total, 3) if total else 0.0,
        "latence_moyenne_edge_ms": round(float(ligne[4] or 0.0), 1),
        "latence_moyenne_cloud_ms": round(float(ligne[5] or 0.0), 1),
        "repartition": {"edge": edge, "cloud": cloud},
    }


async def recuperer_etat_historique() -> dict:
    """Charge l'état durable pour réinitialiser le registre mémoire.

    Retourne la structure attendue par ``registre.reinitialiser_etat`` :
    historique (100 derniers), compteur total, temps d'inférence par source.
    """
    async with _sessions() as session:
        resultat_total = await session.execute(text("SELECT COUNT(*) FROM diagnostics"))
        total = resultat_total.scalar()

        lignes = (
            await session.execute(
                text(
                    "SELECT id_diagnostic, execute_le, destination_choisie, statut, "
                    "       temps_total_ms, contexte_depistage "
                    "FROM diagnostics ORDER BY id_diagnostic DESC LIMIT :limite"
                ),
                {"limite": CAPACITE_REHYDRATATION},
            )
        ).all()

        temps_edge = (
            (
                await session.execute(
                    text(
                        "SELECT temps_inference_ms FROM resultats_pathologiques "
                        "WHERE source_finale = 'edge'"
                    )
                )
            )
            .scalars()
            .all()
        )
        temps_cloud = (
            (
                await session.execute(
                    text(
                        "SELECT temps_inference_ms FROM resultats_pathologiques "
                        "WHERE source_finale = 'cloud'"
                    )
                )
            )
            .scalars()
            .all()
        )

        historique = []
        for ligne in lignes:
            id_diag = ligne[0]
            resultats = (
                await session.execute(
                    text(
                        "SELECT pathologie, prediction, confiance_finale, "
                        "       temps_inference_ms, source_finale, confiance_initiale, "
                        "       source_initiale, determinant "
                        "FROM resultats_pathologiques WHERE id_diagnostic = :id "
                        "ORDER BY rang"
                    ),
                    {"id": id_diag},
                )
            ).all()
            escalades = (
                await session.execute(
                    text(
                        "SELECT pathologie, source_initiale, confiance_initiale, "
                        "       source_controle, confiance_controle, decision, raison "
                        "FROM escalades_controle WHERE id_diagnostic = :id"
                    ),
                    {"id": id_diag},
                )
            ).all()

            historique.append(
                {
                    "id": id_diag,
                    "horodatage": _iso(ligne[1]),
                    "destination": ligne[2],
                    "resultats": [
                        {
                            "pathologie": r[0],
                            "prediction": r[1],
                            "confiance": float(r[2]),
                            "temps_inference_ms": float(r[3]),
                            "source": r[4],
                            "confiance_initiale": _opt_v(r[5]),
                            "source_initiale": r[6],
                            "indetermine": not bool(r[7]),
                        }
                        for r in resultats
                    ],
                    "escalades": [
                        {
                            "pathologie": e[0],
                            "source_initiale": e[1],
                            "confiance_initiale": float(e[2]),
                            "source_controle": e[3],
                            "confiance_controle": float(e[4]),
                            "decision": e[5],
                            "raison": e[6],
                        }
                        for e in escalades
                    ],
                    "temps_total_ms": round(float(ligne[4]), 1),
                    "statut": ligne[3],
                    "contexte": ligne[5],
                }
            )

    return {
        "historique": historique,
        "compteur": total or 0,
        "temps_edge": [float(t) for t in temps_edge],
        "temps_cloud": [float(t) for t in temps_cloud],
    }


def _iso(valeur) -> str:
    """Convertit la valeur SQL en horodatage ISO pour le registre."""
    return valeur.isoformat(timespec="seconds") if hasattr(valeur, "isoformat") else str(valeur)


def _opt_v(valeur) -> float | None:
    return float(valeur) if valeur is not None else None


async def verdits_cliniques_examen(id_examen: int) -> list[dict]:
    """Verdicts cliniques du dernier diagnostic d'un examen (Vague 2).

    Prend le diagnostic le plus recent de l'examen, comme le fait la file de
    triage : une reanalyse ne doit pas produire deux jeux de recommandations
    contradictoires.
    """
    if not _sessions:
        return []
    async with _sessions() as session:
        resultat = await session.execute(
            text(
                "SELECT id_diagnostic FROM diagnostics WHERE id_examen = :id "
                "ORDER BY id_diagnostic DESC LIMIT 1"
            ),
            {"id": id_examen},
        )
        id_diagnostic = resultat.scalar()
        if id_diagnostic is None:
            return []
    return (await _verdits_par_diagnostic([int(id_diagnostic)])).get(int(id_diagnostic), [])


def _positif_pour(verdicts: list[dict], pathologie: str) -> dict | None:
    for verdict in verdicts:
        if verdict.get("pathologie") == pathologie and verdict.get("prediction") == "positif":
            return verdict
    return None


async def protocole_validation() -> dict | None:
    """Agregats de la file de triage pour la page Statistiques (Vague 2).

    Une seule requete SQL (la vue ``v_protocole_validation``) : compter la file
    en chargeant tous les examens serait un gaspillage, et le comptage en Python
    divergerait de la base des qu'un examen est analysé entre deux appels.

    ``None`` si la base est indisponible : la page affiche alors « indisponible »
    plutot que des zéros, qui seraient un mensonge — 23 examens n'attendent pas
    la même chose que 0.
    """
    if not _sessions:
        return None
    async with _sessions() as session:
        ligne = (await session.execute(text("SELECT * FROM v_protocole_validation"))).first()
    if ligne is None:
        return None

    colonnes = (
        "examens_analyses",
        "examens_approuves",
        "examens_desapprouves",
        "examens_en_attente",
        "examens_non_approuves",
        "decisions_journalisees",
        "otp_revoques",
        "controles_a_venir",
        "delai_moyen_heures",
    )
    # Les compteurs sont des entiers, mais le délai est un nombre decimal :
    # un int() le tronquerait a 3,9 h -> 3 h, un delai fausse dans un rapport
    # de charge.
    agregats = {
        nom: (float(valeur) if nom == "delai_moyen_heures" else int(valeur or 0))
        for nom, valeur in zip(colonnes, ligne)
    }

    # Part de la file validee, sur 100. Null des qu'aucun examen n'a ete
    # approuve : afficher 0 % se lirait comme un indicateur de performance,
    # alors que c'est l'absence de toute decision, pas une performance nulle.
    # Le test le verifie — 23 analyses sans une seule approbation donnent
    # « aucun examen valide », pas « 0 % de validation ».
    analyses = agregats["examens_analyses"]
    approuves = agregats["examens_approuves"]
    agregats["taux_validation"] = (
        round(approuves * 100 / analyses, 1) if approuves > 0 and analyses > 0 else None
    )
    return agregats


async def existe_otp_actif_patient(id_patient: int) -> bool:
    """Le patient dispose-t-il d'un code encore accepte par ``verifier_otp`` ?

    Le partage WhatsApp renvoie le patient vers le portail en lui demandant
    d'utiliser « le code de consultation qu'il a recu ». Cette promesse n'est
    vraie que si un code existe et n'a pas ete revoque. Or l'emission peut
    echouer (SMTP indisponible, relais absent) alors que la validation est
    deja journalisee : sans cette verification, le message promettrait un
    code jamais transmis.

    Les codes sont permanents (Vague 1) : seule la revocation les retire.
    """
    if not _sessions:
        return False
    async with _sessions() as session:
        compte = await session.execute(
            text("""
                SELECT COUNT(*)
                  FROM otp_codes
                 WHERE id_patient = :id_patient
                   AND revoque_le IS NULL
                """),
            {"id_patient": id_patient},
        )
    return int(compte.scalar() or 0) > 0


# ---------------------------------------------------------------------------
# Synthese du poste (tableau de bord clinicien)
# ---------------------------------------------------------------------------

_SYNTHESE_FILE_SQL = text("""
    WITH dernier AS (
        SELECT DISTINCT ON (dg.id_examen)
               dg.id_examen, dg.id_diagnostic, dg.execute_le
        FROM diagnostics dg
        ORDER BY dg.id_examen, dg.execute_le DESC, dg.id_diagnostic DESC
    )
    SELECT l.id_examen,
           l.id_diagnostic,
           l.execute_le,
           COALESCE(ve.statut::text, 'sans_decision') AS etat
    FROM dernier l
    LEFT JOIN v_etat_validation ve ON ve.id_examen = l.id_examen
    """)


async def synthese_poste(seuil_alerte_jours: int = 2) -> dict:
    """Agregats du poste clinicien : ou en est la file, ce qui presse, ce qui est promis.

    Unitee de compte : **l'examen**, jamais le diagnostic. La table
    ``diagnostics`` compte les re-analyses d'un meme clichet — 1 010 lignes
    pour 25 examens, dont 947 le jour de la passe de charge des scenarios.
    Compter la serie en analyses afficherait un pic de 947 unites comme de
    l'activite clinique : exactement le genre de chiffre fabrique qu'une page
    de synthese ne doit pas produire.

    Les valeurs de la file reprennent la meme semantique que
    :func:`lister_file_triage` et la vue ``v_protocole_validation``, pour que
    le tableau de bord et la page Protocole ne puissent pas diverger.

    Rien ici n'est stocke : tout est recalcule a la lecture, comme l'alerte de
    la file. Une alerte derivee qui s'ecrirait en base deviendrait fausse
    d'elle-meme au lendemain, sans que personne ne la reclasse.
    """
    if not _sessions:
        raise SQLAlchemyError("Base de donnees indisponible")

    now = datetime.now(UTC)

    # 1. File : etat courant et anciennete de chaque examen analyse.
    async with _sessions() as session:
        lignes = (await session.execute(_SYNTHESE_FILE_SQL)).all()

        # 2. Examens enregistres par jour. Les jours sans examen sont absents
        #    de la serie : le graphique doit montrer un trou, pas un zero.
        activite = [
            {"jour": r[0], "examens": int(r[1])}
            for r in (
                await session.execute(
                    text(
                        "SELECT importer_le::date, COUNT(*) "
                        "FROM examens_image GROUP BY 1 ORDER BY 1"
                    )
                )
            ).all()
        ]

        # 3. Decisions de validation par jour. Compte toutes les lignes du
        #    journal d'ajout, pas l'etat courant : une reapprobation apres un
        #    desaccord est une seconde decision, et c'est bien de la charge du
        #    clinicien qu'on compte. Compare a `activite`, la soustraction des
        #    deux series dit si la file se vide ou se remplit.
        decisions_par_jour = [
            {"jour": r[0], "decisions": int(r[1])}
            for r in (
                await session.execute(
                    text(
                        "SELECT cree_le::date, COUNT(*) "
                        "FROM validations_cliniques GROUP BY 1 ORDER BY 1"
                    )
                )
            ).all()
        ]

        # 4. Volume total et dossiers joignables. Un dossier sans telephone ni
        #    email ne peut pas recevoir l'OTP d'approbation : le dire ici evite
        #    au clinicien de decouvrir l'echec apres avoir valide.
        total_examens, dossiers, joignables = (
            await session.execute(
                text(
                    "SELECT (SELECT COUNT(*) FROM examens_image), "
                    "       (SELECT COUNT(*) FROM patients), "
                    "       (SELECT COUNT(*) FROM patients "
                    "         WHERE telephone IS NOT NULL OR email IS NOT NULL)"
                )
            )
        ).one()

        # 5. Echeances des controles promis aux patients, et repartition des
        #    statuts pour le bilan de tenue des suivis.
        echeances = [
            {
                "date_suivi": r[0].isoformat() if r[0] else None,
                "statut": r[1],
                "code_patient": r[2],
                "motif": r[3],
            }
            for r in (
                await session.execute(
                    text(
                        "SELECT s.date_suivi, s.statut::text, p.code_patient, s.motif "
                        "FROM suivis_cliniques s "
                        "JOIN patients p ON p.id_patient = s.id_patient "
                        "ORDER BY s.date_suivi"
                    )
                )
            ).all()
        ]

    total_examens = int(total_examens or 0)
    dossiers = int(dossiers or 0)
    joignables = int(joignables or 0)

    # Etats de la file. Un examen sans validation est « a valider » : c'est un
    # etat de tracabilite, pas une qualite du diagnostic (cf. page Protocole).
    a_valider = [r for r in lignes if r[3] == "sans_decision"]
    valides = [r for r in lignes if r[3] == "approuve"]
    desapproves = [r for r in lignes if r[3] == "desapprouve"]

    # Un examen enregistre mais jamais analyse n'existe pas dans ``lignes`` :
    # il est comptabilise a part, sinon le total des parts ne retomberait pas
    # sur le nombre d'examens.
    jamais_analyses = max(0, total_examens - len(lignes))

    def _jours(r) -> int:
        return (now - r[2]).days

    en_retard = [r for r in a_valider if _jours(r) >= seuil_alerte_jours]
    age_max = max((_jours(r) for r in a_valider), default=0)

    # Anciennete de la file, en tranches. Ordre fixe : c'est un classement
    # d'urgence, pas un tri de valeurs.
    bornes = (
        ("aujourd_hui", 0, 0),
        ("1_jour", 1, 1),
        ("2_a_6_jours", 2, 6),
        ("plus_de_7_jours", 7, None),
    )
    anciennete = []
    for libelle, mini, maxi in bornes:
        nombre = sum(
            1 for r in a_valider if _jours(r) >= mini and (maxi is None or _jours(r) <= maxi)
        )
        anciennete.append({"tranche": libelle, "examens": nombre})

    # Verdicts portes par le DERNIER diagnostic de chaque examen, jamais par
    # l'ensemble des 1 023 verdicts stockes : ces derniers include les
    # re-analyses de la passe de charge et les verdicts d'autres instants.
    verdicts = await _verdits_par_diagnostic([r[1] for r in lignes])
    repartition: dict[str, dict[str, int]] = {}
    for liste in verdicts.values():
        for v in liste:
            cle = repartition.setdefault(v["pathologie"], {})
            cle[v["prediction"]] = cle.get(v["prediction"], 0) + 1
    verdits_par_pathologie = [
        {
            "pathologie": pathologie,
            "negatif": compte.get("negatif", 0),
            "positif": compte.get("positif", 0),
            "indetermine": compte.get("indetermine", 0),
        }
        for pathologie, compte in sorted(repartition.items())
    ]

    # Reutilisee telle quelle : le taux affiche ici et celui de la page
    # Protocole sortent de la meme vue, ils ne peuvent pas diverger.
    protocole = await protocole_validation() or {}
    if not protocole:
        protocole = {
            "examens_analyses": len(lignes),
            "taux_validation": None,
            "delai_moyen_heures": 0.0,
        }

    statuts_suivis: dict[str, int] = {}
    for e in echeances:
        statuts_suivis[e["statut"]] = statuts_suivis.get(e["statut"], 0) + 1

    return {
        "seuil_alerte_jours": seuil_alerte_jours,
        "file": {
            "a_valider": len(a_valider),
            "en_retard": len(en_retard),
            "age_max_jours": age_max,
            "valides": len(valides),
            "desapproves": len(desapproves),
            "jamais_analyses": jamais_analyses,
            "total_examens": total_examens,
            "examens_analyses": len(lignes),
            "anciennete": anciennete,
        },
        "patients": {"dossiers": dossiers, "joignables": joignables},
        "validations": {
            "taux_validation": protocole.get("taux_validation"),
            "delai_moyen_heures": protocole.get("delai_moyen_heures"),
            "decisions_journalisees": protocole.get("decisions_journalisees", 0),
        },
        "activite": activite,
        "decisions_par_jour": decisions_par_jour,
        "verdits_par_pathologie": verdits_par_pathologie,
        "suivis": {
            "a_venir": [e for e in echeances if e["statut"] == "planifie"],
            "par_statut": statuts_suivis,
            "total": len(echeances),
            "realises": statuts_suivis.get("realise", 0),
        },
    }
