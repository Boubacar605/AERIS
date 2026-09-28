-- ============================================================================
-- AERIS — Postgres : vues d'agrégation pour le tableau de bord
-- ----------------------------------------------------------------------------
-- Les statistiques ne sont jamais recalculées côté application : ces vues SQL
-- encapsulent les agrégats et garantissent une sémantique unique de calcul.
-- ============================================================================

-- Statistiques globales (équivalent de /etat-systeme -> statistiques)
CREATE OR REPLACE VIEW v_statistiques_globales AS
SELECT
    COUNT(*)                                              AS total,
    ROUND(100.0 * COUNT(*) FILTER (WHERE statut = 'completed')
                 / NULLIF(COUNT(*), 0), 1)                AS taux_reussite_pourcent,
    ROUND(AVG(temps_total_ms)
          FILTER (WHERE destination_choisie = 'edge'), 1) AS latence_moyenne_edge_ms,
    ROUND(AVG(temps_total_ms)
          FILTER (WHERE destination_choisie = 'cloud'), 1) AS latence_moyenne_cloud_ms,
    COUNT(*) FILTER (WHERE destination_choisie = 'edge')  AS total_edge,
    COUNT(*) FILTER (WHERE destination_choisie = 'cloud') AS total_cloud
FROM diagnostics;

-- Derniers diagnostics enrichis (équivalent de /historique) : image, patient, verdicts
CREATE OR REPLACE VIEW v_derniers_diagnostics AS
SELECT
    d.id_diagnostic,
    d.execute_le,
    d.destination_choisie,
    d.statut,
    d.temps_total_ms,
    d.contexte_depistage,
    e.nom_fichier,
    e.format_fichier,
    p.code_patient,
    ARRAY_AGG(
        rp.pathologie || ':' || rp.prediction || ':' || rp.source_finale
        ORDER BY rp.rang
    ) AS verdicts
FROM diagnostics d
JOIN examens_image e   ON e.id_examen = d.id_examen
LEFT JOIN patients p   ON p.id_patient = e.id_patient
LEFT JOIN resultats_pathologiques rp ON rp.id_diagnostic = d.id_diagnostic
GROUP BY d.id_diagnostic, d.execute_le, d.destination_choisie, d.statut,
         d.temps_total_ms, d.contexte_depistage, e.nom_fichier, e.format_fichier,
         p.code_patient
ORDER BY d.execute_le DESC;

-- Performance par modèle IA (histoire de la dérive des modèles)
CREATE OR REPLACE VIEW v_performance_modeles AS
SELECT
    m.identifiant_code,
    m.pathologie,
    m.environnement,
    m.version_modele,
    COUNT(rp.id_resultat)                                   AS nb_inferences,
    ROUND(AVG(rp.temps_inference_ms), 1)                    AS latence_moyenne_ms,
    ROUND(AVG(rp.confiance_finale), 4)                      AS confiance_moyenne,
    COUNT(*) FILTER (WHERE rp.prediction = 'positif')       AS nb_positifs
FROM modeles_ia m
LEFT JOIN resultats_pathologiques rp ON rp.id_modele = m.id_modele
GROUP BY m.id_modele
ORDER BY m.identifiant_code;
-- ---------------------------------------------------------------------------
-- Vague 1 — etat courant de validation d'un examen
-- ---------------------------------------------------------------------------
-- DISTINCT ON garde la derniere decision ; l'historique complet reste lisible
-- dans validations_cliniques.
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
ORDER BY v.id_examen, v.id_validation DESC;

-- Agregats de la file de triage (Vague 2). Une seule requete pour la page
-- Statistiques : sans elle, le compte des examens en attente obligerait a
-- charger toute la file en memoire pour la compter.
-- « sans_decision » = aucune ligne dans validations_cliniques : les examens
-- anterieurs a la Vague 1 y sont donc comptes, ce qui est la realite du poste.
CREATE OR REPLACE VIEW v_protocole_validation AS
SELECT
    (SELECT COUNT(DISTINCT d.id_examen)
       FROM diagnostics d
      WHERE d.statut = 'completed')                                        AS examens_analyses,
    (SELECT COUNT(*) FROM v_etat_validation WHERE statut = 'approuve')     AS examens_approuves,
    (SELECT COUNT(*) FROM v_etat_validation WHERE statut = 'desapprouve')  AS examens_desapprouves,
    (SELECT COUNT(*) FROM v_etat_validation WHERE statut = 'en_attente')   AS examens_en_attente,
    (SELECT COUNT(DISTINCT d.id_examen)
       FROM diagnostics d
      WHERE d.statut = 'completed'
        AND NOT EXISTS (SELECT 1 FROM v_etat_validation v
                         WHERE v.id_examen = d.id_examen
                           AND v.statut = 'approuve'))                     AS examens_non_approuves,
    (SELECT COUNT(*) FROM validations_cliniques)                          AS decisions_journalisees,
    (SELECT COUNT(*) FROM otp_codes WHERE revoque_le IS NOT NULL)          AS otp_revoques,
    (SELECT COUNT(*) FROM suivis_cliniques WHERE statut = 'planifie')     AS controles_a_venir,
    (SELECT COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (v.cree_le - d.execute_le)) / 3600), 1), 0)
       FROM validations_cliniques v
       JOIN diagnostics d ON d.id_examen = v.id_examen)                   AS delai_moyen_heures;

COMMENT ON VIEW v_protocole_validation IS
    'Agregats de la Vague 2 : volumetrie de la file, decisions, revocations, '
    'controles a venir et delai moyen de validation en heures (moyenne, pas '
    'mediane : le calcul exact d''une mediane sur un DISTINCT ON par examen '
    'n''apporte rien a l''echelle d''un poste de travail).';
