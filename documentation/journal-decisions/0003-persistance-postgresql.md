# ADR-0003 : Persistance PostgreSQL des donnees du moteur

## Statut

Accepte

## Contexte

Le moteur de decision maintenait tout son etat en memoire : buffer circulaire de 100 diagnostics, compteur de requetes, temps moyens d'inference. Un redemarrage du conteneur (reboot de la machine, mise a jour, panne) vidait integralement l'historique : le tableau de bord affichait un historique vide et les statistiques repartaient de zero. Or le jury de soutenance attend une demonstration « qui tient la route » — la perte silencieuse des donnees apres un reboot etait un handicap majeur.

Deux contraintes a respecter :

- **Non-blocage** : l'ecriture varique ne doit jamais retarder le pipeline d'inference (l'analyse d'une radiographie prend 0,5 a 7 secondes ; l'ajout d'un cycle SQL au milieu serait imperceptible mais irreverencieux).
- **Degradation propre** : sans base joignable (developpement, tests, reseau coupe), le moteur doit continuer a fonctionner de maniere identique a son comportement historique, sans option de repli fragile.

## Decision

Ajout de PostgreSQL 16 comme conteneur de volume (`aeris-postgres-donnees`, named volume) et d'une couche de persistance asynchrone dans le moteur.

### Schema de donnees

Modele relationnel en 3e forme normale, construit par les scripts `/infrastructure/postgres/init/*.sql` au premier boot du volume (types contentieux en amont, vues et triggers inclus) :

- **Entites cliniques** : `patients` (anonymises, aucun champ nominatif — code opaque), `examens_image` (dedoublonnage par empreinte SHA-256).
- **Referentiels** : `modeles_ia` (4 modeles TB/PN × edge/cloud), `versions_configuration` (seuils du moteur versionnes dans le temps, une seule version « courante » garantie par index partiel sur `active_jusqu_a IS NULL`).
- **Cœur du pipeline** : `diagnostics` (une execution du routage : destination, raison, metriques de contexte, latences, temps d'inference), `profils_images_analysees` (1:1, profilage technique + routage selectif), `resultats_pathologiques` (verdict par pathologie, contrainte d'unicite par diagnostic), `escalades_controle` (justicatif du filet de confiance).
- **Observabilite** : `telemetrie_observations` (serie temporelle du cycle `/etat-systeme`, complementaire de Prometheus : historique interrogeable en SQL).
- **Vues d'agregation** : `v_statistiques_globales`, `v_derniers_diagnostics`, `v_performance_modeles` — les statistiques ne sont jamais recalculees cote application, une seule semantique de calcul.
- **Audit** : triggers `BEFORE UPDATE` mettant a jour `modifie_le` automatiquement.

### Couche applicative (persistance.py)

- **File asynchrone** : chaque diagnostic est depose dans un `deque` ; un worker arriere-plan flushe par lots toutes les `persistance_interval_seconde` (2 s). `asyncio.create_task` dans le `lifespan` FastAPI.
- **Rehydratation** : au demarrage, `recuperer_etat_historique()` recharge les 100 derniers diagnostics, le compteur total et les temps d'inference par source ; `registre_diagnostics.reinitialiser_etat()` restaure l'etat memoire. Apres un redemarrage, l'historique retrouve exactement son etat precedent.
- **Bornage des echecs** : un lot en echec (base momentanement injoignable) est rejoue au cycle suivant ; un element definitivement invalide est abandonne apres 5 tentatives (pas de boucle infinie).
- **Degradation** : `DATABASE_URL` vide ou base injoignable → persistance inactives, le moteur reste sur son registre memoire (comportement historique, 38 tests inchanges a l'epoque du choix).
- **ORM** : SQLAlchemy 2.0 asynchrone (driver psycopg 3), `Base.metadata` alimente Alembic.

### Migrations

Alembic 1.13 est mis en place (`alembic.ini`, `env.py` lisant `DATABASE_URL` du moteur). La revision `0001` (baseline, volontairement vide) represente l'etat initial pose par les scripts init : Alembic prend le relais pour toute evolution future du schema, jamais a la main.

## Justification

- **Durabilite** : le redemarrage du moteur ne perd plus rien — prouve : apres recreations successives du conteneur, `/historique`, les statistiques et les moyennes d'inference sont integralement restaures.
- **Non-blocage** : aucune ecriture dans le chemin critique de l'inference ; le worker absorbe les pics de charge.
- **Observabilite exploitable** : l'historique devient interrogeable en SQL (perf des modeles par version, repartition edge/cloud), au-dela des metriques temps reel de Prometheus.
- **Normes** : 3NF, PK `BIGINT GENERATED ALWAYS AS IDENTITY`, types ENUM, `CHECK`, `timestamptz`, dedoublonnage par hash, versionnement temporel des configurations — un modele « haut de gamme » defendable devant un jury.

## Consequences

### Impacts

- Serveur PostgreSQL 16 expose sur le port 5433 de l'hote (profils `complet` uniquement). Le volume nomme `aeris-postgres-donnees` persiste les donnees au-dela des redemarrages de conteneurs.
- Nouveau bloc `persistance.py` dans le moteur (~600 lignes) ; les dependances `sqlalchemy[asyncio]`, `psycopg[binary]` et `alembic` ajoutees au moteur.
- La configuration `DATABASE_URL` est injectee dans le compose ; le moteur attend `postgres: healthy` (dependance non bloquante, `required: false`).

### Limites documentees

- La telemetrie ecrit une ligne par sondage et cycle : la table grossit indefiniment — une politique de retention (par ex. partitionnement mensuel + purge > 90 jours) est une evolution future, non bloquante pour la demo.
- `resultats_pathologiques.id_modele` est le point d'entree de `v_performance_modeles` : le rattachement (pathologie × source) est effectue a l'ecriture, il suppose que le referentiel `modeles_ia` est coherent avec les services deployes.
- Le schéma initial est construit par les scripts init uniquement ; Alembic commence a `0001` (baseline des mesures) : toute representation du schema initial par migration serait redondante avec les scripts init.