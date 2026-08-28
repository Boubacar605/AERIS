# Architecture AERIS

## Vue d'ensemble

AERIS est une architecture Edge-Cloud adaptative orientee microservices concue pour le triage radiologique assiste par IA. Le systeme route dynamiquement les requetes d'inference entre un noeud Edge (local, ressources limitees) et le Cloud (distant, ressources abondantes) selon l'etat du systeme.

## Composants

### Services d'inference (x2)

Deux services identiques dans leur interface mais specialises par pathologie :
- **Service Tuberculose** : CNN pre-entraine sur les datasets Shenzhen + Montgomery
- **Service Pneumonie** : CNN pre-entraine sur le dataset Chest X-Ray (Kaggle)

Chaque service est deployable independamment sur l'Edge ou le Cloud. Le meme conteneur peut tourner dans les deux contextes, seule la variable `MODE_DEPLOIEMENT` change.

### Moteur de Decision (coeur du systeme)

Point d'entree unique pour les radiographies. Il :
1. Collecte les metriques systeme (CPU, RAM Edge + latence reseau)
2. Applique un arbre de decision base sur des seuils configurables
3. Transmet l'image aux services appropriate (Edge ou Cloud)
4. Agregre les resultats des deux diagnostics

### Tableau de Bord

Interface React permettant au personnel medical de :
- Soumettre des radiographies
- Visualiser les resultats de diagnostic
- Surveiller les metriques systeme en temps reel
- Observer les decisions de routage

## Flux de donnees

```
Personnel medical
       |
       | Upload radiographie
       v
[Tableau de Bord] --> [Moteur de Decision]
                            |
                     Evaluation metriques
                            |
                     +------+------+
                     |             |
                     v             v
              [Services Edge] [Services Cloud]
              (TB + PN)       (TB + PN)
                     |             |
                     +------+------+
                            |
                     Resultats agreges
                            |
                            v
                   [Tableau de Bord]
                   Affichage diagnostic
```

## Communication inter-services

Tous les services communiquent via HTTP/REST (JSON). Aucune dependance directe entre les services — decouplage total via API.

## Simulation de l'Edge

L'Edge est simule via Docker avec des limites de ressources :
- `--cpus`: limite le nombre de coeurs CPU
- `--memory`: limite la memoire disponible

Cela permet de reproduire les contraintes d'un materiel embarque sans necessiter du hardware physique.
