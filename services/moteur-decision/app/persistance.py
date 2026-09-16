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
import secrets
from collections import deque
from datetime import date as date_naissance
from datetime import datetime, timedelta, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Enum as SqlEnum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.dialects.postgresql import ARRAY
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
    date_naissance: Mapped[date_naissance | None] = mapped_column(
        Date
    )
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
    importer_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))


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
    specialistes_admissibles: Mapped[list[str]] = mapped_column(
        ARRAY(Text), default=list
    )
    cle_regle: Mapped[str | None] = mapped_column(String)
    regle_appliquee: Mapped[str | None] = mapped_column(Text)
    specialiste_ecarte: Mapped[str | None] = mapped_column(enum_pathologie)
    raison: Mapped[str | None] = mapped_column(Text)


class ResultatPathologique(Base):
    __tablename__ = "resultats_pathologiques"
    __table_args__ = (UniqueConstraint("id_diagnostic", "pathologie"),)

    id_resultat: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    id_diagnostic: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("diagnostics.id_diagnostic")
    )
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
    id_diagnostic: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("diagnostics.id_diagnostic")
    )
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
    cree_le: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    modifie_le: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CodeOtp(Base):
    __tablename__ = "otp_codes"

    id_otp: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    id_patient: Mapped[int] = mapped_column(BigInteger, ForeignKey("patients.id_patient"))
    id_examen: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("examens_image.id_examen")
    )
    email_destination: Mapped[str] = mapped_column(Text, nullable=False)
    code_hash: Mapped[str] = mapped_column(String, nullable=False)
    expire_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    tentatives: Mapped[int] = mapped_column(Integer, default=0)
    utilise_le: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cree_le: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


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


async def _assurer_referentiels() -> None:
    """Garantit les référentiels minimaux (idempotent).

    Supprime toute dépendance au script seed : le moteur fonctionne même sur
    une base créée uniquement par les modèles ORM.
    """
    async with _sessions() as session:
        async with session.begin():
            resultat_codes = await session.execute(
                text("SELECT identifiant_code FROM modeles_ia")
            )
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


# ---------------------------------------------------------------------------
# Helpers RBAC : utilisateurs, patients, OTP
# ---------------------------------------------------------------------------

_MAX_TENTATIVES_OTP = 5


async def _assurer_admin_initial(session: AsyncSession) -> None:
    """Cree le compte admin initial si aucun admin actif n'existe."""
    from app.authentification import hacher_mot_de_passe

    resultat = await session.execute(
        text("SELECT id_utilisateur FROM utilisateurs WHERE role = 'admin' AND actif = true LIMIT 1")
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
                mot_de_passe_hash=hacher_mot_de_passe(mot_de_passe_hash)
                if not mot_de_passe_hash.startswith("$2")
                else mot_de_passe_hash,
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
                "date_naissance": (
                    r[11].isoformat() if r[11] is not None else None
                ),
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
    annee = datetime.now(timezone.utc).year
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


# ---------------------------------------------------------------------------
# OTP
# ---------------------------------------------------------------------------

from app.otp import generer_otp, hacher_otp  # noqa: E402


async def generer_et_stocker_otp(
    id_patient: int,
    id_examen: int | None,
    destination: str,
) -> str:
    """Genere un OTP, le stocke hashé en base, retourne le code en clair.

    ``destination`` est le contact qui recevra le code : adresse email OU
    numero WhatsApp (le champ SQL ``email_destination`` sert de destination
    generique pour les deux canaux).
    """
    code = generer_otp(config.otp_longueur)
    code_hash = hacher_otp(code)
    expire_le = datetime.now(timezone.utc) + timedelta(minutes=config.otp_ttl_minutes)

    async with _sessions() as session:
        async with session.begin():
            otp = CodeOtp(
                id_patient=id_patient,
                id_examen=id_examen,
                email_destination=destination,
                code_hash=code_hash,
                expire_le=expire_le,
            )
            session.add(otp)

    return code


async def verifier_et_consommer_otp(code: str, destination: str) -> Patient | None:
    """Verifie un OTP (non expire, non utilise, tentatives < max).

    Le code est identifie par son empreinte (chaque code est unique) ; le
    contact saisi par le patient ne sert qu'a confirmer qu'il est bien le
    destinataire. Il doit correspondre a la destination stockee (le canal
    reellement notifie) OU a l'autre contact du patient (meme code envoye
    sur email ET WhatsApp, une seule destination stockee).
    Retourne le Patient associe si valide, None sinon.
    Le code est consomme (utilise_le mis a jour) en cas de succes.
    """
    from app.otp import hacher_otp as _hacher
    from app.whatsapp import normaliser_numero as _normaliser_numero

    code_hash = _hacher(code)

    async with _sessions() as session:
        async with session.begin():
            resultat = await session.execute(
                text(
                    "SELECT id_otp, id_patient, code_hash, expire_le, "
                    "       tentatives, utilise_le, email_destination "
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

            id_otp, id_patient, hash_db, expire_le, tentatives, utilise_le, email_dest = ligne

            # Deja utilise
            if utilise_le is not None:
                return None

            # Trop de tentatives
            if tentatives >= _MAX_TENTATIVES_OTP:
                return None

            # Expire
            now = datetime.now(timezone.utc)
            if expire_le.tzinfo is None:
                expire_le = expire_le.replace(tzinfo=timezone.utc)
            if now > expire_le:
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

            # Code valide → consommer
            await session.execute(
                text("UPDATE otp_codes SET utilise_le = now() WHERE id_otp = :id"),
                {"id": id_otp},
            )

            return patient


async def obtenir_resultats_par_patient(id_patient: int) -> list[dict]:
    """Recupere le resultat de la DERNIERE analyse d'un patient.

    Un code OTP n'ouvre qu'un unique compte rendu, comme un etablissement de
    sante delivre le resultat d'une consultation : on ne renvoie donc que le
    diagnostic le plus recent (id le plus eleve), sans le repertoire complet
    des examens du patient.
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
                "WHERE e.id_patient = :id_patient "
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
                id_patient = element.get("id_patient") or await _obtenir_patient_par_defaut(
                    session
                )
                id_examen = await _obtenir_ou_creer_examen(session, element, id_patient)
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
                        float(element["temps_escalade_ms"]) if element.get("temps_escalade_ms") else None
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
                        _construire_resultat(resultat, diagnostic.id_diagnostic, rang, ids_modeles[cle])
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


async def _obtenir_ou_creer_examen(
    session: AsyncSession, element: dict, id_patient: int
) -> int:
    """Dédoublonne par empreinte SHA-256 du contenu."""
    hash_contenu = element.get("hash_contenu") or _hacher_contenu(
        element.get("contenu", b"")
    )
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
                text(
                    "UPDATE examens_image SET id_patient = :p "
                    "WHERE id_examen = :id"
                ),
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
            await session.execute(
                text(
                    "SELECT temps_inference_ms FROM resultats_pathologiques "
                    "WHERE source_finale = 'edge'"
                )
            )
        ).scalars().all()
        temps_cloud = (
            await session.execute(
                text(
                    "SELECT temps_inference_ms FROM resultats_pathologiques "
                    "WHERE source_finale = 'cloud'"
                )
            )
        ).scalars().all()

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