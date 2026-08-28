# Service Pneumonie

Service d'inference IA pour la detection de la pneumonie par analyse de radiographies thoraciques.

## Role

Recoit une image de radiographie thoracique et retourne une prediction (positif/negatif) avec un score de confiance. Le modele utilise est un CNN pre-entraine (Keras/TensorFlow) entraine sur le dataset Chest X-Ray (Kaggle).

## Endpoints

| Methode | Chemin | Description |
|---------|--------|-------------|
| GET | `/sante` | Healthcheck du service |
| GET | `/` | Informations generales |
| POST | `/diagnostic/analyser` | Analyse d'une radiographie (multipart/form-data) |
| GET | `/metrics` | Metriques Prometheus |

## Lancement isole

```bash
cd services/service-pneumonie
pip install -r requirements.txt
uvicorn app.principal:app --host 0.0.0.0 --port 8002 --reload
```

## Tests

```bash
cd services/service-pneumonie
pytest tests/ -v
```

## Variables d'environnement

| Variable | Defaut | Description |
|----------|--------|-------------|
| `SERVICE_PN_PORT` | 8002 | Port d'ecoute |
| `SERVICE_PN_CHEMIN_MODELE` | `./modeles_entraines/modele_pneumonie.h5` | Chemin vers le modele |
| `MODE_DEPLOIEMENT` | cloud | Mode actuel (edge ou cloud) |
