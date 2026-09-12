-- ============================================================================
-- AERIS — Postgres : domaines énumérés
-- ----------------------------------------------------------------------------
-- Les domaines stables sont des types ENUM natifs : typage fort au niveau du
-- moteur SGBD, aucune valeur libre ne peut traîner dans les colonnes.
-- Le moteur de décision s'appuie sur ces domaines pour toutes ses colonnes
-- catégorielles.
-- ============================================================================

-- Pathologies dépistées par la plateforme
CREATE TYPE t_pathologie AS ENUM ('tuberculose', 'pneumonie');

-- Destination d'exécution du pipeline d'inférence
CREATE TYPE t_destination AS ENUM ('edge', 'cloud');

-- Verdict rendu par un modèle pour une pathologie
CREATE TYPE t_statut_verdict AS ENUM ('positif', 'negatif');

-- Issue globale d'une analyse (le verdict "indéterminé" est porté par la
-- colonne `determinant` des résultats, pas par un statut)
CREATE TYPE t_statut_analyse AS ENUM ('completed', 'failed');

-- Contexte clinique saisi par le soignant (prime sur le profilage)
CREATE TYPE t_contexte_depistage AS ENUM ('auto', 'tuberculose', 'pneumonie', 'general');

-- Décision rendue par un contrôle qualité (escalade Edge <-> Cloud)
CREATE TYPE t_decision_escalade AS ENUM (
    'arbitrage_a_prevalu',
    'arbitrage_conserve_initial',
    'escalade_impossible'
);