# Guide de contribution

## Conventions de commit

Format : Conventional Commits en francais.

```
<type>: <description courte>

[corps optionnel]
```

Types :
- `feat:` — nouvelle fonctionnalite
- `fix:` — correction de bug
- `docs:` — documentation
- `chore:` — maintenance, configuration
- `test:` — ajout ou modification de tests
- `refactor:` — refactoring sans changement fonctionnel

Exemples :
```
feat: ajout endpoint diagnostic au service pneumonie
fix: correction du calcul de latence reseau
docs: mise a jour du schema d'architecture
chore: mise a jour des dependances Python
```

## Conventions de branche

- `main` — branche stable, deployable
- `develop` — integration des fonctionnalites en cours
- `feat/<nom>` — branche de fonctionnalite
- `fix/<nom>` — branche de correction

## Style de code

### Python

- Type hints obligatoires sur toutes les fonctions
- Formatage : `black` (ligne max 100 caracteres)
- Lint : `ruff`
- Docstrings et commentaires en francais

### TypeScript

- `strict: true` dans tsconfig
- ESLint + Prettier
- Commentaires en francais

## Nomenclature

Tous les fichiers et dossiers crees dans le cadre du projet sont nommes en francais, sauf ceux dont le nom est impose par un outil (Dockerfile, package.json, requirements.txt, etc.).
