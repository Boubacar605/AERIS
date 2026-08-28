# Donnees

Ce dossier est destine a contenir les jeux de donnees utilises pour l'entrainement et l'evaluation des modeles.

## Structure attendue

```
donnees/
├── tuberculose/     # Dataset Shenzhen + Montgomery (radiographies thoraciques)
└── pneumonie/       # Dataset Chest X-Ray (Kaggle)
```

## Important

- Les donnees ne sont PAS commitees dans le depot (voir .gitignore)
- Chaque dataset doit etre telecharge separement depuis sa source
- Respecter les licences d'utilisation des datasets

## Sources

- **Tuberculose** : Shenzhen Hospital X-ray Set + Montgomery County X-ray Set (NIH)
- **Pneumonie** : Chest X-Ray Images (Kaggle, Kermany et al.)
