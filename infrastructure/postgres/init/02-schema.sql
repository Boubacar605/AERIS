-- ============================================================================
-- AERIS — Postgres : schéma relationnel
-- ----------------------------------------------------------------------------
-- Modèle en 3e forme normale. Chaque fait est à sa place, aucune redondance.
--
--  patients                   sujets anonymisés (aucune donnée nominative)
--  examens_image              fichiers radiographiques soumis (1..n par patient)
--  modeles_ia                 référentiel des modèles (TB/PN × edge/cloud)
--  versions_configuration     référentiel versionné des seuils du moteur
--  diagnostics                une exécution du pipeline de routage
--  profils_images_analysees   profilage technique de l'image (1:1 par diagnostic)
--  resultats_pathologiques    verdict par pathologie exécutée (1..n)
--  escalades_controle         traces des contrôles qualité (1..n)
--  telemetrie_observations    série temporelle d'observabilité
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Entités cliniques
-- ---------------------------------------------------------------------------

CREATE TABLE patients (
    id_patient      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code_patient    TEXT        NOT NULL UNIQUE,          -- ex. AERIS-2026-0001
    sexe            CHAR(1)     NULL CHECK (sexe IN ('F', 'M', 'X')),
    annee_naissance SMALLINT    NULL,                     -- jamais de date exacte
    note            TEXT        NULL,
    cree_le         TIMESTAMPTZ NOT NULL DEFAULT now(),
    modifie_le      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE patients IS
    'Sujets d''examen anonymisés : aucun champ nominatif, code opaque uniquement.';

CREATE TABLE examens_image (
    id_examen       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_patient      BIGINT      NOT NULL REFERENCES patients (id_patient) ON DELETE RESTRICT,
    code_examen     TEXT        NOT NULL UNIQUE,          -- ex. EXA-2026-0001
    nom_fichier     TEXT        NOT NULL,
    format_fichier  TEXT        NULL,                     -- PNG, JPEG…
    taille_octets   BIGINT      NOT NULL DEFAULT 0 CHECK (taille_octets >= 0),
    hash_contenu    TEXT        NOT NULL UNIQUE,          -- SHA-256, anti-doublon
    chemin_stockage TEXT        NULL,
    importer_le     TIMESTAMPTZ NOT NULL DEFAULT now(),
    modifie_le      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN examens_image.hash_contenu IS
    'Empreinte SHA-256 du fichier : une même image ne crée jamais un second examen (dédoublonnage).';
CREATE INDEX idx_examens_patient ON examens_image (id_patient);

-- ---------------------------------------------------------------------------
-- Référentiels
-- ---------------------------------------------------------------------------

CREATE TABLE modeles_ia (
    id_modele        BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    identifiant_code TEXT         NOT NULL UNIQUE,        -- ex. tb-edge-v3
    pathologie       t_pathologie NOT NULL,
    environnement    t_destination NOT NULL,              -- où tourne le modèle
    version_modele   TEXT         NOT NULL,
    libelle          TEXT         NULL,
    actif            BOOLEAN      NOT NULL DEFAULT true,
    cree_le          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (pathologie, environnement, version_modele)
);

COMMENT ON TABLE modeles_ia IS
    'Referentiel des modeles IA deployes : chaque verdict est rattaché au modele '
    'reellement execute, pour mesurer l''evolution de la performance par version.';

CREATE TABLE versions_configuration (
    id_version            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    libelle               TEXT        NULL,
    seuil_cpu             NUMERIC(5,2)  NOT NULL,
    seuil_ram             NUMERIC(5,2)  NOT NULL,
    seuil_latence_ms      NUMERIC(8,2)  NOT NULL,
    confiance_escalade    NUMERIC(4,3)  NULL,
    confiance_indetermine NUMERIC(4,3)  NULL,
    profilage_active      BOOLEAN     NOT NULL DEFAULT true,
    seuil_ratio_carre_inf NUMERIC(5,3)  NULL,
    seuil_ratio_carre_sup NUMERIC(5,3)  NULL,
    seuil_ratio_pn        NUMERIC(5,3)  NULL,
    format_image_tb       TEXT        NULL,
    format_image_pn       TEXT        NULL,
    active_a_partir       TIMESTAMPTZ NOT NULL DEFAULT now(),
    active_jusqu_a        TIMESTAMPTZ NULL,
    cree_le               TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT verif_periode_validite CHECK (
        active_jusqu_a IS NULL OR active_jusqu_a > active_a_partir
    )
);

COMMENT ON TABLE versions_configuration IS
    'Versionnement temporel des seuils du moteur : un diagnostic reference la '
    'version en vigueur au moment du routage, ce qui permet de rejouer son raisonnement.';
CREATE UNIQUE INDEX uq_versions_courante
    ON versions_configuration (active_a_partir)
    WHERE active_jusqu_a IS NULL;  -- une seule version "courante" à la fois

-- ---------------------------------------------------------------------------
-- Cœur : une exécution du pipeline
-- ---------------------------------------------------------------------------

CREATE TABLE diagnostics (
    id_diagnostic            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_examen                BIGINT       NOT NULL REFERENCES examens_image (id_examen) ON DELETE RESTRICT,
    id_version_configuration BIGINT       NULL REFERENCES versions_configuration (id_version) ON DELETE RESTRICT,
    contexte_depistage       t_contexte_depistage NOT NULL DEFAULT 'auto',
    destination_choisie      t_destination NOT NULL,
    raison_decision          TEXT         NOT NULL,
    cpu_pourcentage          NUMERIC(5,2) NULL CHECK (cpu_pourcentage BETWEEN 0 AND 100),
    ram_pourcentage          NUMERIC(5,2) NULL CHECK (ram_pourcentage BETWEEN 0 AND 100),
    latence_reseau_ms        NUMERIC(8,2) NULL,
    reseau_disponible        BOOLEAN      NULL,
    temps_total_ms           NUMERIC(10,2) NOT NULL DEFAULT 0,
    temps_escalade_ms        NUMERIC(10,2) NULL,
    statut                   t_statut_analyse NOT NULL DEFAULT 'completed',
    execute_le               TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE diagnostics IS
    'Une exécution compleète du pipeline de routage sur un examen : decision de '
    'destination, metriques de contexte à ce moment-là, latences, statut.';
CREATE INDEX idx_diagnostics_date        ON diagnostics (execute_le DESC);
CREATE INDEX idx_diagnostics_examen      ON diagnostics (id_examen);
CREATE INDEX idx_diagnostics_destination ON diagnostics (destination_choisie);

CREATE TABLE profils_images_analysees (
    id_profil                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_diagnostic             BIGINT NOT NULL UNIQUE
                              REFERENCES diagnostics (id_diagnostic) ON DELETE CASCADE,  -- 1:1
    format_image              TEXT        NULL,
    largeur_px                INTEGER     NULL CHECK (largeur_px IS NULL OR largeur_px > 0),
    hauteur_px                INTEGER     NULL CHECK (hauteur_px IS NULL OR hauteur_px > 0),
    ratio_largeur_hauteur     NUMERIC(6,3) NULL,
    mode_canaux               TEXT        NULL,           -- RGB, L…
    taille_octets             BIGINT      NULL,
    indecodable               BOOLEAN     NOT NULL DEFAULT false,
    specialistes_admissibles  TEXT[]      NOT NULL DEFAULT '{}',
    cle_regle                 TEXT        NULL,
    regle_appliquee           TEXT        NULL,
    specialiste_ecarte        t_pathologie NULL,
    raison                    TEXT        NULL
);

COMMENT ON TABLE profils_images_analysees IS
    'Profil technique extrait de l''entête de l''image au moment de l''analyse et '
    'routage sélectif résultant (règle, spécialiste(s) admissible(s), écarté).';

CREATE TABLE resultats_pathologiques (
    id_resultat         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_diagnostic       BIGINT      NOT NULL REFERENCES diagnostics (id_diagnostic) ON DELETE CASCADE,
    id_modele           BIGINT      NULL REFERENCES modeles_ia (id_modele) ON DELETE SET NULL,
    pathologie          t_pathologie NOT NULL,
    prediction          t_statut_verdict NOT NULL,
    confiance_finale    NUMERIC(4,3) NOT NULL CHECK (confiance_finale BETWEEN 0 AND 1),
    confiance_initiale  NUMERIC(4,3) NULL CHECK (confiance_initiale IS NULL OR confiance_initiale BETWEEN 0 AND 1),
    source_finale       t_destination NOT NULL,
    source_initiale     t_destination NULL,
    determinant         BOOLEAN     NOT NULL DEFAULT true,   -- false si verdict "indéterminé"
    temps_inference_ms  NUMERIC(10,2) NOT NULL DEFAULT 0,
    rang                SMALLINT    NOT NULL DEFAULT 1,      -- 1 = tuberculose, 2 = pneumonie
    UNIQUE (id_diagnostic, pathologie)                       -- un seul verdict par patho et par analyse
);

COMMENT ON COLUMN resultats_pathologiques.confiance_initiale IS
    'Confiance avant escalade : non-NULL signifie qu''un contrôle qualité a eu lieu '
    '(le flag "escalade" de l''API se déduit de cette présence).';
CREATE INDEX idx_resultats_diagnostic ON resultats_pathologiques (id_diagnostic);

CREATE TABLE escalades_controle (
    id_escalade         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_diagnostic       BIGINT NOT NULL REFERENCES diagnostics (id_diagnostic) ON DELETE CASCADE,
    id_resultat         BIGINT NULL REFERENCES resultats_pathologiques (id_resultat) ON DELETE SET NULL,
    pathologie          t_pathologie NOT NULL,
    source_initiale     t_destination NOT NULL,
    confiance_initiale  NUMERIC(4,3) NOT NULL CHECK (confiance_initiale BETWEEN 0 AND 1),
    source_controle     t_destination NOT NULL,
    confiance_controle  NUMERIC(4,3) NOT NULL CHECK (confiance_controle BETWEEN 0 AND 1),
    decision            t_decision_escalade NOT NULL,
    raison              TEXT        NULL,
    execute_le          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_escalades_diagnostic ON escalades_controle (id_diagnostic);

-- ---------------------------------------------------------------------------
-- Observabilité (série temporelle)
-- ---------------------------------------------------------------------------

CREATE TABLE telemetrie_observations (
    id_observation BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    horodatage     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    departement    TEXT         NOT NULL,          -- 'edge' | 'cloud' | 'moteur'
    conteneur      TEXT         NULL,
    nom_mesure     TEXT         NOT NULL,          -- 'cpu_pourcentage', 'latence_reseau_ms'…
    valeur         NUMERIC(12,4) NOT NULL,
    unite          TEXT         NULL
);

COMMENT ON TABLE telemetrie_observations IS
    'Série temporelle d''observabilité : CPU, RAM, disque, latence… horodatées. '
    'Complète Prometheus en rendant l''historique interrogeable en SQL.';
CREATE INDEX idx_telemetrie_arrivee
    ON telemetrie_observations (departement, nom_mesure, horodatage DESC);