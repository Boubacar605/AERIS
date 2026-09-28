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
-- Issue d'un controle a venir (Vague 1)
CREATE TYPE t_statut_suivi AS ENUM ('planifie', 'realise', 'annule');

-- Decision du clinicien sur un examen (Vague 1). « en_attente » n'est cree que
-- par une decision explicite du soignant : l'absence de ligne vaut deja
-- « a valider ».
CREATE TYPE t_statut_validation AS ENUM ('en_attente', 'approuve', 'desapprouve');

-- Roles applicatifs (Vague 1 : ces types manquaient aussi a l'init, ils etaient
-- crees par create_all). Aligne sur app/persistance.py::enum_role.
CREATE TYPE t_role AS ENUM ('admin', 'clinicien');
