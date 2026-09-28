-- ============================================================================
-- AERIS — Postgres : données de référence initiales
-- ----------------------------------------------------------------------------
-- Référentiels indispensables au fonctionnement du moteur : les quatre modèles
-- IA déployés et la première version des seuils de décision (alignée sur le
-- fichier de configuration du moteur).
-- ============================================================================

-- Modèles IA de la démo
INSERT INTO modeles_ia (identifiant_code, pathologie, environnement, version_modele, libelle)
VALUES
    ('tb-edge',  'tuberculose', 'edge',  '1.0', 'Classifieur TB Edge'),
    ('tb-cloud', 'tuberculose', 'cloud', '1.0', 'Classifieur TB Cloud'),
    ('pn-edge',  'pneumonie',   'edge',  '1.0', 'Classifieur PN Edge'),
    ('pn-cloud', 'pneumonie',   'cloud', '1.0', 'Classifieur PN Cloud');

-- Première version des seuils de décision (valeurs par défaut du moteur)
INSERT INTO versions_configuration (
    libelle,
    seuil_cpu,
    seuil_ram,
    seuil_latence_ms,
    confiance_escalade,
    confiance_indetermine,
    profilage_active,
    seuil_ratio_carre_inf,
    seuil_ratio_carre_sup,
    seuil_ratio_pn,
    format_image_tb,
    format_image_pn
)
VALUES (
    'Version initiale 2026',
    80, 85, 100,
    0.75, 0.60,
    true,
    0.9, 1.1, 1.1,
    'PNG', 'JPEG'
);