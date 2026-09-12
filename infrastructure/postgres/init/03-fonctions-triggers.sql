-- ============================================================================
-- AERIS — Postgres : triggers de gestion d'horodatage
-- ----------------------------------------------------------------------------
-- Met à jour automatiquement la colonne modifie_le sur les entités modifiables
-- sans que l'application ait à s'en soucier (audit fiable côté SGBD).
-- ============================================================================

CREATE OR REPLACE FUNCTION maj_horodatage()
RETURNS TRIGGER AS $$
BEGIN
    NEW.modifie_le := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Entités portant un cycle de vie modifiable
CREATE TRIGGER trg_patients_maj
    BEFORE UPDATE ON patients
    FOR EACH ROW EXECUTE FUNCTION maj_horodatage();

CREATE TRIGGER trg_examens_maj
    BEFORE UPDATE ON examens_image
    FOR EACH ROW EXECUTE FUNCTION maj_horodatage();