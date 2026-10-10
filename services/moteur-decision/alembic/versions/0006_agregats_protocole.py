"""Agregats de la file de triage (Vague 2).

Contexte de la migration (Vague 2 du memoire) :
- la file de validation creee par 0005 repondait a la question « qu'est-ce qui
  attend une decision ? » examen par examen. La page **Protocole** pose
  l'autre question, celle du bilan de poste : combien d'examens ont ete
  analyses, approuves, desapprouves, combien de decisions sont journalisees,
  combien de codes ont ete revoques, combien de controles sont a venir, et en
  combien de temps un examen analyse obtient sa decision ;
- ces neuf chiffres viennent de la vue ``v_protocole_validation``, pas d'un
  comptage applicatif : un examen analyse entre deux appels fausserait un total
  recompute en Python, et un clinicien qui compare deux pages finirait par ne
  plus croire a aucune des deux.

Aucune ecriture : la vue ne fait que deriver l'etat courant du journal
``validations_cliniques`` deja pose par 0005. Elle ne pre-cree aucune ligne, ne
retroactive aucune validation — un examen sans decision reste « sans decision ».

Deux lectures qui n'ont pas de valeur par defaut, et qui sont donc portees par
le code appelant plutot que par la vue :
- ``taux_validation`` est calcule cote Python et vaut ``null`` des qu'aucun
  examen n'est approuve. Un 0 % se lirait comme un indicateur de performance
  alors que c'est une absence de decision ;
- une base indisponible donne 503, jamais des compteurs a zero : un clinicien
  ne doit pas pouvoir conclure « file vide » a partir d'une panne.

Revision : 0006 (succede a 0005, les suivis et validations cliniques).
Create Date: 2026-09-28
"""

from collections.abc import Sequence

from alembic import op

# Identifiant de revision : chaine courte unique (prefixe numerique/heure).
revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Cree la vue d'agregats du protocole de validation."""
    op.execute("""
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
        """)
    op.execute("""
        COMMENT ON VIEW v_protocole_validation IS
            'Agregats de la Vague 2 : volumetrie de la file, decisions, '
            'revocations, controles a venir et delai moyen de validation en '
            'heures (moyenne, pas mediane).'
        """)


def downgrade() -> None:
    """Supprime la vue. Le journal des decisions, lui, n'est pas touche."""
    op.execute("DROP VIEW IF EXISTS v_protocole_validation")
