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
from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
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

_logger = logging.getLogger("aeris.persistance")

CAPACITE_REHYDRATATION = 100
MAX_TENTATIVES_PERSISTANCE = 5

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


class Patient(Base):
    __tablename__ = "patients"

    id_patient: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code_patient: Mapped[str] = mapped_column(String, unique=True)
    sexe: Mapped[str | None] = mapped_column(String(1))
    annee_naissance: Mapped[int | None] = mapped_column(Integer)
    note: Mapped[str | None] = mapped_column(Text)
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
            id_patient = await _obtenir_patient_par_defaut(session)
            id_version = await _obtenir_version_courante(session)

            for element in items:
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