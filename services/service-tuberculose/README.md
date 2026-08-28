# Service Tuberculose

Service d'inference IA pour la detection de la tuberculose par analyse de radiographies thoraciques.

## Role

Recoit une image de radiographie thoracique et retourne une prediction (positif/negatif) avec un score de confiance. Le modele utilise est un CNN pre-entraine (Keras/TensorFlow) derive des datasets Shenzhen et Montgomery.

## Endpoints

| Methode | Chemin | Description |
|---------|--------|-------------|
| GET | `/sante` | Healthcheck du service |
| GET | `/` | Informations generales |
| POST | `/diagnostic/analyser` | Analyse d'une radiographie (multipart/form-data) |
| GET | `/metrics` | Metriques Prometheus |

## Lancement isole

```bash
cd services/service-tuberculose
pip install -r requirements.txt
uvicorn app.principal:app --host 0.0.0.0 --port 8001 --reload
```

## Tests

```bash
cd services/service-tuberculose
pytest tests/ -v
```

## Variables d'environnement

| Variable | Defaut | Description |
|----------|--------|-------------|
| `SERVICE_TB_PORT` | 8001 | Port d'ecoute |
| `SERVICE_TB_CHEMIN_MODELE` | `./modeles_entraines/modele_tuberculose.h5` | Chemin vers le modele |
| `MODE_DEPLOIEMENT` | cloud | Mode actuel (edge ou cloud) |
