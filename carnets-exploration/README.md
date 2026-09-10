# Carnets d'exploration

Notebooks Jupyter utilises pour l'entrainement et l'evaluation des modeles d'inference AERIS.

## Notebooks

| Notebook | Role | Algorithme | Dataset |
|----------|------|------------|---------|
| `notebook-modele-tuberculose.ipynb` | Modele Edge tuberculose | CNN Sequential (96x96 RGB) | Shenzhen + Montgomery (~800 images) |
| `notebook-modele-tuberculose-cloud.ipynb` | Modele Cloud tuberculose | DenseNet121 transfer learning (320x320 RGB) | TB Chest Radiography Database (4200 images) |
| `notebook-modele-pneumonie.ipynb` | Modele Edge pneumonie | CNN Sequential (150x150 grayscale) | Chest X-Ray Kaggle (5863 images) |
| `notebook-lung-opacity-reference.ipynb` | Reference / exploration | VGG16 transfer learning (384x384 RGB) | RSNA Pneumonia Detection |

## Procedure de regeneration des modeles

### Pre-requis

1. Telecharger les datasets (voir `donnees/README.md`)
2. Installer les dependances : `pip install tensorflow opencv-python numpy pandas scikit-learn matplotlib seaborn Pillow`
3. Les notebooks ont ete developpes sur Kaggle — les chemins d'entree (`../input/...`) doivent etre adaptes pour un usage local

### Generation des modeles Edge

Les modeles Edge (lourds) sont generes par les notebooks :

1. **TB Edge** : `notebook-modele-tuberculose.ipynb`
   - Produit `model.h5` → copier dans `services/service-tuberculose/modeles_entraines/modele_tuberculose.h5`
   - Entrees : 96x96 RGB, normalisation rescale (/255)
   - Sortie : softmax 2 classes (Normal, Tuberculose)

2. **PN Edge** : `notebook-modele-pneumonie.ipynb`
   - Produit un modele Sequential → sauvegarder en `.h5` dans `services/service-pneumonie/modeles_entraines/modele_pneumonie.h5`
   - Entrees : 150x150 grayscale (1 canal), normalisation rescale (/255)
   - Sortie : sigmoid (score < 0.5 = PNEUMONIE)

### Generation des modeles Cloud

1. **TB Cloud** : `notebook-modele-tuberculose-cloud.ipynb`
   - Produit des poids DenseNet121 → convertir en `.h5` complet pour `services/service-tuberculose/modeles_entraines/modele_tuberculose_cloud.h5`
   - Entrees : 320x320 RGB, normalisation samplewise
   - Sortie : sigmoid 1 neuron

2. **PN Cloud** : pas de notebook dedie pour le Cloud pneumonie. Le modele Cloud utilise la meme architecture DenseNet121 que le TB Cloud, entraine sur le dataset pneumonie. A documenter ou creer un notebook dedie si necessaire.

### Fichiers a generer

```
services/service-tuberculose/modeles_entraines/
├── modele_tuberculose.h5          (Edge — notebook-modele-tuberculose.ipynb)
└── modele_tuberculose_cloud.h5    (Cloud — notebook-modele-tuberculose-cloud.ipynb)

services/service-pneumonie/modeles_entraines/
├── modele_pneumonie.h5            (Edge — notebook-modele-pneumonie.ipynb)
└── modele_pneumonie_cloud.h5      (Cloud — notebook a creer/documenter)
```

**Note** : Ces fichiers `.h5` sont excludes du version control (voir `.gitignore`). Chaque developpeur doit les regenerer localement a partir des notebooks.

## Important

- Les notebooks ont ete executes sur Kaggle avec GPU (Tesla P100). L'entrainement local sans GPU sera significativement plus lent.
- Les modeles Cloud utilisent le transfer learning (DenseNet121, poids ImageNet) et sont plus precis mais plus volumineux.
- Les modeles Edge sont des CNN legers entraines from-scratch, optimises pour des ressources limitees.
