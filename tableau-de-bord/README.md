# AERIS Insight

Tu es un senior UI/UX designer spécialisé dans les interfaces SaaS technologiques, AI platforms, observability dashboards et systèmes distribués.

Je travaille sur AERIS, une plateforme expérimentale d'orchestration Edge-Cloud pour des services d'intelligence artificielle.

Le prototype actuel fonctionne déjà. Je veux maintenant une REFONTE VISUELLE MAJEURE du dashboard afin d'obtenir une interface beaucoup plus premium, moderne, immersive et crédible pour une démonstration de mémoire de Master 2.

IMPORTANT :

- Ne détruis pas les fonctionnalités existantes.

- Ne modifie pas inutilement la logique métier.

- Ne supprime aucune donnée existante.

- Conserve les routes, composants fonctionnels, appels API et fonctionnalités déjà implémentés lorsque cela est possible.

- Le travail demandé est principalement une refonte UI/UX et une meilleure hiérarchisation visuelle.

- Le résultat doit ressembler à une véritable plateforme professionnelle de supervision d'une infrastructure Edge-Cloud + IA, et non à un simple dashboard CRUD.

==================================================

1. IDENTITÉ DU PRODUIT

==================================================

Nom :

AERIS

Sous-titre :

Adaptive Edge-Cloud AI Platform

Contexte :

AERIS est une plateforme permettant d'orchestrer dynamiquement l'exécution de services d'intelligence artificielle entre un nœud Edge local et un environnement Cloud.

Le cas d'étude actuel est le triage radiologique assisté par IA avec :

- Service Tuberculose

- Service Pneumonie

Mais l'interface doit surtout mettre en valeur l'ARCHITECTURE EDGE-CLOUD et son moteur de décision, car cette architecture doit pouvoir être réutilisée dans d'autres domaines comme le transport, l'agriculture ou l'industrie.

L'interface doit donc communiquer visuellement :

DATA → AI → DECISION → EDGE/CLOUD → RESULT → MONITORING

==================================================

2. PROBLÈME DU DESIGN ACTUEL

==================================================

Le dashboard actuel est propre mais trop générique.

Il ressemble à un tableau de bord administratif avec :

- beaucoup de cartes rectangulaires classiques ;

- trop d'espace vide ;

- des métriques isolées ;

- une hiérarchie visuelle faible ;

- peu de sensation de système temps réel ;

- le moteur de décision Edge-Cloud n'est pas suffisamment central ;

- les données sont affichées mais ne racontent pas clairement ce que fait le système.

Je veux donc une refonte qui donne immédiatement l'impression :

"Je regarde le centre de contrôle d'une plateforme intelligente qui décide en temps réel où exécuter des traitements IA."

==================================================

3. DIRECTION ARTISTIQUE

==================================================

Créer une esthétique premium inspirée des plateformes modernes de :

- AI infrastructure

- Cloud computing

- observability

- distributed systems

- MLOps

- cybersecurity/SOC dashboards

Éviter absolument :

- l'apparence d'un dashboard bancaire ;

- l'apparence d'un ERP ;

- les grosses cartes basiques avec uniquement un titre + chiffre ;

- les gradients excessifs ;

- les animations inutiles ;

- le style gaming ;

- les interfaces médicales trop "hôpital".

Style recherché :

- professionnel

- technologique

- scientifique

- minimaliste

- élégant

- premium

- dense mais lisible

- légèrement futuriste

Palette principale :

- Navy / bleu nuit profond pour l'identité AERIS

- blanc / gris très clair pour les surfaces principales

- bleu pour le Cloud

- ambre/orange pour l'Edge

- vert uniquement pour les états opérationnels

- rouge uniquement pour les alertes

Utiliser les couleurs avec parcimonie.

==================================================

4. STRUCTURE GLOBALE

==================================================

Créer une application avec :

SIDEBAR GAUCHE :

- logo AERIS

- "Adaptive Edge-Cloud AI"

- Dashboard

- Diagnostic

- Historique

- Monitoring

- Architecture

- éventuellement Settings

La sidebar doit être élégante, compacte et moderne.

En haut du contenu :

- titre de la page

- état global du système

- indicateur "SYSTEM OPERATIONAL"

- heure/date de dernière synchronisation

- éventuellement bouton de rafraîchissement

==================================================

5. NOUVEAU DASHBOARD PRINCIPAL

==================================================

Le dashboard principal doit être organisé autour d'un élément central :

"EDGE-CLOUD DECISION ENGINE"

C'est le cœur visuel de la page.

La page doit raconter une histoire.

--------------------------------------------------

SECTION 1 — SYSTEM OVERVIEW

--------------------------------------------------

Créer une bandeau supérieur compact avec quelques informations globales :

SYSTEM STATUS

● Operational

EDGE NODE

● Online

CLOUD

● Online

NETWORK

● Stable

ACTIVE MODEL

TB Classifier

REQUESTS TODAY

47

Éviter de transformer chaque information en énorme carte.

--------------------------------------------------

SECTION 2 — EDGE-CLOUD DECISION ENGINE

--------------------------------------------------

Cette section doit être la pièce maîtresse du dashboard.

Créer une visualisation graphique claire du pipeline :

                INCOMING AI REQUEST

                         │

                         ▼

                 DECISION ENGINE

                         │

              ┌──────────┴──────────┐

              ▼                     ▼

            EDGE                  CLOUD

        Local inference       Remote inference

Mais rendre cette visualisation moderne et dynamique.

Afficher visuellement le chemin actuellement sélectionné.

Exemple :

REQUEST #47

Radiographie thoracique

        ↓

ANALYZING

        ↓

EDGE SELECTED

Afficher ensuite les raisons de la décision :

NETWORK

34 ms

Stable

EDGE CPU

42%

Available

EDGE RAM

58%

Available

DECISION SCORE

Edge 0.87

Cloud 0.62

DECISION :

"Traitement local privilégié"

La branche sélectionnée doit être visuellement mise en évidence.

La branche non sélectionnée doit être plus discrète.

Lorsque le système choisit Cloud, le chemin Cloud doit automatiquement devenir dominant.

L'objectif est que l'utilisateur puisse comprendre en moins de 3 secondes :

"Le système a reçu une requête, analysé les conditions et choisi Edge/Cloud."

--------------------------------------------------

SECTION 3 — LIVE SYSTEM METRICS

--------------------------------------------------

Ne pas utiliser uniquement des cartes avec des chiffres.

Utiliser de petits graphiques temps réel.

Afficher :

EDGE CPU

42%

EDGE RAM

58%

NETWORK LATENCY

34 ms

THROUGHPUT

18 req/min

Ajouter des mini sparkline charts représentant l'évolution récente.

Exemple :

CPU

42%

╭──╮

│  ╰──╮

│     ╰────

╰──────────

LATENCY

34 ms

╭─╮

│ ╰──╮

│    ╰────

╰─────────

Les graphiques doivent rester sobres et élégants.

--------------------------------------------------

SECTION 4 — INFERENCE ACTIVITY

--------------------------------------------------

Créer une vraie section "Live Inference Activity".

Afficher une timeline des dernières requêtes.

Exemple :

14:23:12

REQUEST #47

TB CLASSIFIER

92% confidence

EDGE

187 ms

✓ Completed

14:22:58

REQUEST #46

TB CLASSIFIER

87% confidence

CLOUD

241 ms

✓ Completed

14:22:31

REQUEST #45

PNEUMONIA CLASSIFIER

91% confidence

EDGE

174 ms

✓ Completed

Utiliser des badges et des petits indicateurs visuels.

--------------------------------------------------

SECTION 5 — EDGE VS CLOUD

--------------------------------------------------

Créer une visualisation comparative.

Titre :

"Execution Distribution"

Afficher par exemple :

EDGE

78%

██████████████████░░

CLOUD

22%

█████░░░░░░░░░░░░░

Mais rendre cela beaucoup plus visuel qu'une simple progress bar.

Ajouter :

- nombre de requêtes

- latence moyenne

- temps moyen d'inférence

- statut

Exemple :

EDGE

78 requests

Avg latency: 183 ms

Status: Healthy

CLOUD

22 requests

Avg latency: 241 ms

Status: Healthy

--------------------------------------------------

SECTION 6 — AI SERVICES

--------------------------------------------------

Afficher les services IA sous forme de composants plus élégants :

TB CLASSIFIER

● Operational

Model: MobileNet / CNN

Inference: 183 ms

Accuracy: XX%

Environment: Edge + Cloud

PNEUMONIA CLASSIFIER

● Operational

Model: ...

Inference: ...

Environment: Edge + Cloud

Mais ne pas faire de ces cartes l'élément principal du dashboard.

Le système Edge-Cloud doit rester au centre.

==================================================

6. PAGE DIAGNOSTIC

==================================================

Créer également une page Diagnostic beaucoup plus premium.

Cette page doit être orientée "AI inference".

Structure :

--------------------------------------------------

NEW ANALYSIS

--------------------------------------------------

Zone de dépôt/import de radiographie :

┌──────────────────────────────────────┐

│                                      │

│        DROP CHEST X-RAY HERE         │

│                                      │

│       or select an image             │

│                                      │

└──────────────────────────────────────┘

Après sélection :

┌──────────────────────┐

│                      │

│   RADIOGRAPH IMAGE   │

│                      │

└──────────────────────┘

À droite :

AI ANALYSIS

Tuberculosis

████████████████░░ 92%

Normal

██░░░░░░░░░░░░░░░░ 8%

Selected execution:

EDGE

Inference time:

187 ms

Decision:

Local processing

Decision reason:

Network stable + Edge resources available

Bouton principal :

ANALYZE IMAGE

Une fois l'analyse terminée, afficher une animation subtile du pipeline :

UPLOAD

→ PREPROCESSING

→ ROUTING

→ AI INFERENCE

→ RESULT

==================================================

7. PAGE ARCHITECTURE

==================================================

Créer une page dédiée appelée :

"Architecture"

Elle doit présenter visuellement l'architecture AERIS.

Créer un diagramme interactif :

                USER / APPLICATION

                       │

                       ▼

                 API GATEWAY

                       │

                       ▼

              DECISION ENGINE

                       │

             ┌─────────┴─────────┐

             ▼                   ▼

          EDGE NODE           CLOUD NODE

             │                   │

       ┌─────┴─────┐       ┌─────┴─────┐

       │ TB Model  │       │ TB Model  │

       │ PN Model  │       │ PN Model  │

       └───────────┘       └───────────┘

             │                   │

             └─────────┬─────────┘

                       ▼

                   AGGREGATOR

                       │

                       ▼

                    RESULT

Afficher les flux avec des animations très subtiles.

Cette page doit pouvoir être montrée au professeur pendant la soutenance pour expliquer l'architecture en quelques secondes.

==================================================

8. PAGE MONITORING

==================================================

Créer une page réellement orientée observability.

Afficher :

EDGE NODE

- CPU

- RAM

- Disk

- inference latency

- requests/sec

CLOUD NODE

- CPU

- RAM

- inference latency

- requests/sec

NETWORK

- latency

- bandwidth

- packet loss

- connectivity status

Afficher des graphiques temporels.

Prévoir des scénarios :

NORMAL

DEGRADED NETWORK

HIGH EDGE LOAD

CLOUD UNAVAILABLE

Le but est de montrer comment l'architecture réagit aux changements de conditions.

==================================================

9. ÉLÉMENT IMPORTANT : EXPLIQUER LES DÉCISIONS

==================================================

Le système AERIS est adaptatif.

Il faut donc rendre les décisions explicables.

À chaque routage, afficher :

WHY EDGE?

Network latency: 34 ms

Edge CPU: 42%

Edge RAM: 58%

Cloud latency: 61 ms

→ Edge selected

ou :

WHY CLOUD?

Network: stable

Edge CPU: 91%

Edge RAM: 88%

Cloud available

→ Cloud selected

Cette information est essentielle pour comprendre la valeur du projet.

==================================================

10. ANIMATIONS

==================================================

Ajouter des animations discrètes et professionnelles :

- flux lumineux ou ligne animée entre les composants ;

- état online/offline ;

- apparition des nouvelles requêtes ;

- mise à jour des métriques ;

- transition Edge ↔ Cloud ;

- pulse léger sur le nœud actif.

NE PAS utiliser :

- animations excessives ;

- effets 3D lourds ;

- éléments qui bougent constamment ;

- animations qui nuisent à la lisibilité.

L'interface doit sembler "vivante" mais scientifique.

==================================================

11. RESPONSIVE DESIGN

==================================================

Le dashboard doit être parfaitement utilisable sur :

- écran desktop 1366x768 ;

- écrans Full HD ;

- laptop ;

- tablette si possible.

Le design actuel doit être optimisé pour éviter :

- grands espaces inutilisés ;

- scroll inutile ;

- cartes trop hautes ;

- informations importantes coupées.

Sur un écran 1366x768, les éléments les plus importants doivent être visibles immédiatement.

==================================================

12. DESIGN SYSTEM

==================================================

Créer un design system cohérent :

Typography :

- police moderne et professionnelle ;

- hiérarchie claire ;

- titres forts ;

- labels discrets.

Cards :

- bordures très légères ;

- radius modéré ;

- ombres discrètes ;

- pas de cartes gigantesques.

Badges :

- Edge → amber

- Cloud → blue

- Operational → green

- Warning → orange

- Error → red

Icons :

Utiliser Lucide Icons ou une bibliothèque cohérente.

==================================================

13. IMPORTANT : NE PAS SURCHARGER

==================================================

Je préfère une interface avec moins d'éléments mais mieux hiérarchisés.

Priorité visuelle :

1. Decision Engine

2. Edge vs Cloud

3. Network / Resource state

4. Live inference

5. AI services

6. détails secondaires

Le dashboard doit raconter visuellement le fonctionnement d'AERIS.

==================================================

14. OBJECTIF FINAL

==================================================

Lorsque quelqu'un ouvre le dashboard, il doit immédiatement comprendre :

"AERIS reçoit une requête IA, analyse les conditions réseau et les ressources disponibles, choisit dynamiquement Edge ou Cloud, exécute le modèle IA et mesure les performances."

Je veux une interface qui puisse être montrée devant un jury de Master 2 et qui donne une impression de :

- projet de recherche sérieux ;

- architecture moderne ;

- Edge Computing ;

- Cloud Computing ;

- IA ;

- orchestration ;

- observability ;

- système distribué.

Le dashboard ne doit surtout pas donner l'impression d'un simple projet étudiant CRUD.

Avant de modifier le code, analyse l'architecture actuelle de l'application et réutilise au maximum les composants et données existants.

Commence par refaire le DASHBOARD PRINCIPAL avec cette nouvelle direction artistique.

Une fois cette page terminée, applique le même design system aux pages Diagnostic, Historique, Monitoring et Architecture.

## Development

Prérequis : Node.js et npm — [installer avec nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```