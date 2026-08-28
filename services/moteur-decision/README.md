# Moteur de Decision

Coeur du systeme AERIS — moteur de decision adaptatif qui route les radiographies vers l'Edge ou le Cloud selon l'etat du systeme.

## Role

Lorsqu'une radiographie est soumise, le moteur :
1. Collecte les metriques systeme (CPU, RAM, latence reseau)
2. Applique les regles de decision basees sur des seuils configurables
3. Route l'image vers les services Edge ou Cloud
4. Retourne les resultats de diagnostic (tuberculose + pneumonie)

## Regles de decision

| Condition | Decision | Raison |
|-----------|----------|--------|
| Reseau indisponible | Edge | Continuite de service, mode degrade |
| Latence > seuil | Edge | Reseau trop lent pour le Cloud |
| CPU Edge > seuil | Cloud | Edge sature, delegation |
| RAM Edge > seuil | Cloud | Edge sature, delegation |
| Conditions normales | Edge | Proximite des donnees, confidentialite |

## Endpoints

| Methode | Chemin | Description |
|---------|--------|-------------|
| GET | `/sante` | Healthcheck |
| GET | `/` | Informations et seuils actuels |
| POST | `/routage/analyser` | Soumet une radiographie pour routage + diagnostic |
| GET | `/metrics` | Metriques Prometheus |

## Lancement isole

```bash
cd services/moteur-decision
pip install -r requirements.txt
uvicorn app.principal:app --host 0.0.0.0 --port 8003 --reload
```

## Tests

```bash
cd services/moteur-decision
pytest tests/ -v
```

## Variables d'environnement

| Variable | Defaut | Description |
|----------|--------|-------------|
| `MOTEUR_DECISION_PORT` | 8003 | Port d'ecoute |
| `SEUIL_CPU` | 80 | Seuil CPU Edge (%) declenchant le routage Cloud |
| `SEUIL_RAM` | 85 | Seuil RAM Edge (%) declenchant le routage Cloud |
| `SEUIL_LATENCE_MS` | 100 | Seuil latence (ms) declenchant le routage Edge |
| `URL_SERVICE_TB_EDGE` | — | URL du service tuberculose Edge |
| `URL_SERVICE_TB_CLOUD` | — | URL du service tuberculose Cloud |
| `URL_SERVICE_PN_EDGE` | — | URL du service pneumonie Edge |
| `URL_SERVICE_PN_CLOUD` | — | URL du service pneumonie Cloud |
