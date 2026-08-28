# ADR-0001 : Choix d'une architecture microservices

## Statut

Accepte

## Contexte

Le systeme doit deployer deux modeles d'IA (tuberculose et pneumonie) de maniere flexible entre Edge et Cloud. Nous devons choisir entre une architecture monolithique et une architecture microservices.

## Decision

Nous adoptons une architecture microservices avec un service par pathologie.

## Justification

- **Tolerance aux pannes** : si le service pneumonie tombe, le service tuberculose continue de fonctionner
- **Deploiement independant** : chaque modele peut etre mis a jour sans affecter l'autre
- **Scalabilite** : ajout futur de nouvelles pathologies sans modification du systeme existant
- **Coherence avec la problematique** : demonstre la capacite du systeme a gerer des pipelines paralleles

## Consequences

- Complexite operationnelle accrue (plus de conteneurs a gerer)
- Communication inter-services par HTTP (latence supplementaire negligeable en reseau local)
- Necessite un moteur de decision central pour coordonner les appels
