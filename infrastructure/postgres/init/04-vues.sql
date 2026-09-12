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