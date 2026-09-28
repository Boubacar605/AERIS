# AGENTS.md — Guide d'intégration AERIS

> **Contrat de travail.** Ce fichier est le point d'entrée obligatoire de tout agent
> (IA ou humain) qui travaille sur ce dépôt. Il ne remplace pas la lecture du code :
> il indique **quoi lire, dans quel ordre, et pourquoi**, puis les règles à ne pas
> enfreindre. Aucune modification ne doit être écrite avant d'avoir suivi la
> [Phase de lecture](#phase-de-lecture-obligatoire).
>
> Le dépôt contient **49 fichiers modifiés non commités**. Ce travail en cours
> appartient à une session précédente et n'est pas un déchet : **ne jamais exécuter
> `git reset --hard`, `git checkout .` ou `git clean`.**

---

## 1. Ce qu'est AERIS

Mémoire de Master 2 Systèmes d'Information (UADB, Sénégal). **Ce n'est pas un projet de
Data Science** : l'IA est un composant. Le sujet est un **problème de système** —
architecture edge/cloud adaptative, orchestration, déploiement, observabilité.

**Problématique :** concevoir un système distribue capable de décider automatiquement
d'exécuter un pipeline d'IA médicale sur l'Edge ou dans le Cloud selon l'état des
ressources et du réseau, tout en gérant la détection de pathologies multiples.

Deux pathologies, deux modèles par couche : **tuberculose (TB)** et **pneumonie (PN)**.
L'Edge est **simulé** par des limites Docker (`--cpus` / `--memory`) et non par du matériel
dédié. La contribution est **architecturale et expérimentale** (4 scénarios mesurés).

```
Radiographie → MOTEUR DE DÉCISION → Edge : TB + PN (modèles light)
                            └──→ Cloud : TB + PN (modèles full)
                 ↓
          Prometheus → Tableau de bord React (triage + observabilité)
```

---

## 2. Phase de lecture obligatoire

L'ordre compte : on lit **du système vers le détail**, pour ne pas casser une chaîne
d'hypothèses. Durée indicative : 45–90 min.

### Étape 0 — Cadrage (5 min)

| Fichier | Ce qu'on en tire |
|---|---|
| `AGENTS.md` (ce fichier) | carte du dépôt, règles |
| `README.md` | vue d'ensemble + commandes de démarrage |
| `CLAUDE.md` | contexte projet, conventions, arborescence attendue |
| `.env.example` | les 42 variables qui pilotent la topologie |
| `docker-compose.yml` | **la vérité sur les services, ports et profils** |

### Étape 1 — Le moteur de décision, cœur de la contribution (20 min)

C'est ici que se trouve la logique à ne pas casser. Lire **dans l'ordre** :

1. `services/moteur-decision/app/config.py` — seuils, URLs, JWT, OTP.
2. `services/moteur-decision/app/principal.py` — montage de l'app, middlewares, `/sante`.
3. `services/moteur-decision/app/logique_routage/selecteur_edge_cloud.py` — **le fichier le
   plus important du dépôt** : règles de routage, escalade de confiance, arbitrage.
4. `services/moteur-decision/app/logique_routage/evaluateur_reseau.py` + `evaluateur_ressources.py`
   — comment les métriques sont obtenues et ce qui se passe en cas d'échec.
5. `services/moteur-decision/app/logique_routage/profil_image.py` — profilage d'en-tête
   d'image (Pillow, ~1 ms) qui affine le routage selon le type de fichier.
6. `services/moteur-decision/app/routes/routage.py` — `POST /routage/analyser` (orchestration
   HTTP), `GET/POST /routage/patient` (identité patient).
7. `services/moteur-decision/app/schemas/schemas_routage.py` — le contrat de données.
8. `services/moteur-decision/app/logique_routage/registre_diagnostics.py` — journal mémoire
   du repli (voir §7 pour l'arbitrage mémoire / PostgreSQL).

### Étape 2 — Persistance, identité, canaux (20 min)

- `services/moteur-decision/app/persistance.py` — schéma, requêtes, agrégats, bootstrap
  de la base si indisponible.
- `infrastructure/postgres/init/0{1..5}-*.sql` — source de vérité du **schéma 3NF**
  (9 tables, 3 vues). ⚠️ Ne pas modifier le SQL sans lire `persistance.py` aussi : les deux
  doivent rester alignés.
- `services/moteur-decision/alembic/versions/` — 4 migrations qui font autorité
  (`0001_baseline` → `0004_flux_patient_automatique`).
- `services/moteur-decision/app/authentification.py` — JWT, refresh, RBAC à 2 rôles
  (`admin`, `clinicien`).
- `services/moteur-decision/app/otp.py`, `notification.py`, `whatsapp.py` — codes à usage
  unique, envoi e-mail/SMTP, relais WhatsApp.
- `services/moteur-decision/app/routes/` — `acces.py`, `admin.py`, `auth.py`, `metriques.py`,
  `sante.py`.

### Étape 3 — Services d'inférence (10 min)

`services/service-tuberculose/` et `services/service-pneumonie/` sont **structure miroir**.
Lire un seul des deux en entier suffit, puis vérifier la symétrie :

- `app/principal.py`, `app/config.py`, `app/coeur/inference.py` (chargement du modèle
  Keras, préprocessing, inférence, mesure de latence), `app/routes/sante.py`,
  `app/routes/diagnostic.py`, `app/schemas/`, `app/ressources.py` (métriques cgroup),
  `tests/`.

`modeles_entraines/` est **vide et gitignoré** (`.gitkeep`) : les `.keras` ne sont pas
versionnés. Sans modèle, les services démarrent mais l'inférence échoue — c'est un état
attendu, pas un bug à « corriger » en téléchargeant n'importe quoi.

### Étape 4 — Frontend (20 min)

- `tableau-de-bord/src/routes/` — **17 routes** (voir §6). Commencer par
  `diagnostic.tsx` (le cœur du triage), puis `resultat.tsx`, `patients.tsx`,
  `suivi.tsx`, `historique.tsx`.
- `tableau-de-bord/src/lib/api.ts` — **client HTTP unique** vers le moteur (Bearer, timeout,
  refresh sur 401, traduction des `detail` FastAPI).
- `tableau-de-bord/src/hooks/use-api.ts` — le polling et les 3 états
  `chargement | live | indisponible`. Aucun repli fictif n'est autorisé (§10).
- `tableau-de-bord/src/lib/authentification.ts` + `authentification-store.ts` — gardes de
  route par rôle, session dans `sessionStorage["aeris.session"]`.
- `tableau-de-bord/src/components/aeris/` — `AppShell`, `DecisionEngine`, `ImageViewer`,
  `PatientResult`, `SyntheseClinique` (croisement TB × PN), `primitives`.
- `tableau-de-bord/src/lib/` — `resultat-store.ts` (transfert mémoire entre pages),
  `export-pdf.ts` (jsPDF), `compte-rendu.ts` (phrases médicales),
  `dernier-resultat.ts` (vulgarisation patient).
- `tableau-de-bord/src/components/ui/` — 46 composants shadcn/Radix : **ne pas modifier
  (code généré upstream)**.

### Étape 5 — Infrastructure et expérimentation (10 min)

- `infrastructure/prometheus/prometheus.yml` — 5 cibles scrapées toutes les 5 s.
- `infrastructure/scripts/` — `demarrage.sh`, `assurer-tunnel.sh`,
  `configurer-tunnel.sh`, `installer-maintien-tunnel.sh` (Tailscale Funnel, `sudo`, `/etc`).
- `infrastructure/systemd/` — unités de maintien du tunnel et hook post-veille.
- `experimentations/communs/` — `collecteur_metriques.py` (le client qui pilote),
  `generateur_charge.py` (stress applicatif dans Docker, **pas** `tc/netem`),
  `prepareur_images.py`, `analyseur_resultats.py`.
- `experimentations/scenario-{tout-cloud,tout-edge,adaptatif,panne}/executer.py` — **4 scénarios**
  (le README racine n'en liste que 3).
- `experimentations/README.md`, `documentation/rapport_experimentation.md` — protocole et
  résultats mesurés.

### Étape 6 — L'historique du projet (5 min)

`documentation/journal-decisions/` contient 4 ADR acceptés : architecture en
microservices, profilage de routage, persistance PostgreSQL, Tailscale Funnel. Toute
évolution contredisant un ADR passe par un nouvel ADR, pas par une modification
silencieuse.

---

## 3. Cartographie des composants

| Composant | Chemin | Rôle | Port hôte |
|---|---|---|---|
| Service TB (Cloud) | `services/service-tuberculose/` | Inférence tuberculose, modèle complet | 8001 |
| Service PN (Cloud) | `services/service-pneumonie/` | Inférence pneumonie, modèle complet | 8002 |
| Service TB (Edge) | idem, profil `edge` | Modèle allégé, mémoire limitée 512 Mo | interne |
| Service PN (Edge) | idem, profil `edge` | Modèle allégé, mémoire limitée 512 Mo | interne |
| Moteur de décision | `services/moteur-decision/` | Routage, escalade, orchestration, RBAC, OTP, patient, métriques | 8003 |
| Tableau de bord | `tableau-de-bord/` | Triage, monitoring, historique, PDF (TanStack Start **SSR**) | 3000 (dev : **8080**) |
| PostgreSQL | `infrastructure/postgres/init/` | Journal durable, patients, examens, résultats | 5433 → 5432 |
| Prometheus | `infrastructure/prometheus/` | Scrape 5 cibles / 5 s | 9090 |
| MailHog | compose | Boîte d'e-mails de développement | 1025 / 8025 |
| Relais WhatsApp | `services/relay-whatsapp/` | whatsapp-web.js + Puppeteer, session persistée, envoi OTP | 3500 |

Profils Docker : `cloud`, `edge`, `complet`, `monitoring`.

```bash
docker compose --profile complet up -d     # tout
docker compose --profile cloud up -d       # cloud seul (moteur compris)
docker compose --profile edge up -d        # edge seul
bash infrastructure/scripts/demarrage.sh  # lanceur (crée .env si absent)
```

⚠️ Les services Edge n'exposent **pas** de port hôte : ils ne sont atteignables que par
le réseau interne `aeris-reseau`. Les ports Edge 8011/8012 évoqués dans `demarrage.sh`
n'existent plus dans le compose.

---

## 4. Le cœur : la décision de routage

Implémentation : `services/moteur-decision/app/logique_routage/selecteur_edge_cloud.py`.
L'ordre est significatif — le réseau est évalué **en premier**.

### 4.1 Routage primaire

| # | Condition | Destination | Raison |
|---|---|---|---|
| 1 | Réseau indisponible (échec de mesure) | **Edge** | mode dégradé, urgence |
| 2 | Latence réseau > `seuil_latence_ms` (100) | **Edge** | WAN trop lent |
| 3 | CPU Edge > `seuil_cpu` (80) **ou** RAM Edge > `seuil_ram` (85) | **Cloud** | Edge saturé |
| 4 | Sinon | **Edge** | défaut, proximité des données |

Un routage **forcé** (`force_destination: edge|cloud`) court-circuite l'évaluation et
**désactive le second avis** : c'est ce qui permet d'isoler une latence dans les scénarios
`tout-cloud` / `tout-edge`.

Le profilage d'image (`profil_image.py`) ajuste ensuite le choix à la forme du fichier
(ratio largeur/hauteur, PNG carré → profil TB, JPEG étiré → profil PN).

### 4.2 Filet de sécurité : escalade de confiance

Après inférence, toute pathologie dont la confiance est **< 0,75**
(`seuil_confiance_escalade`) est ré-évaluée sur **l'autre couche**. Les deux avis sont
arbitrés au plus confiant, chaque contrôle est tracé (`EvenementEscalade`), et un verdict
encore ambigu est marqué `indetermine` (< 0,60). **Ne jamais renvoyer une valeur par
défaut** : un « n'importe quoi » est un bug clinique.

### 4.3 Croisement TB × PN

`SyntheseClinique.tsx` (front) arbitre deux modèles **binaires indépendants** avec
`SEUIL_INDETERMINE = 0.6` et `SEUIL_NORMAL_CONFIANT = 0.75`, et signale explicitement la
cross-réactivité et les conflits. C'est la partie la plus subtilement incorrecte du système
sur le plan clinique (§12).

---

## 5. Contrat d'API (moteur, port 8003)

| Méthode | Chemin | Accès |
|---|---|---|
| `GET` | `/sante` | public |
| `GET` | `/metrics` | public (⚠️ voir §12) |
| `GET` | `/` | public — seuils de routage courants |
| `GET` | `/sante-services` | authentifié |
| `GET` | `/etat-systeme` | admin |
| `GET` | `/historique?limite=` | authentifié |
| `GET` | `/routage/patient?telephone=` | clinicien |
| `POST` | `/routage/patient` | clinicien |
| `POST` | `/routage/analyser` | clinicien |
| `POST` | `/auth/connexion`, `/auth/rafraichir` | public |
| `GET` | `/auth/moi` | authentifié |
| `GET`/`POST` | `/admin/utilisateurs` | admin |
| `PATCH` | `/admin/utilisateurs/{id_utilisateur}` | admin |
| `GET`/`POST` | `/admin/patients` | admin |
| `PATCH` | `/admin/patients/{id_patient}` | admin |
| `POST` | `/admin/patients/{id_patient}/renvoyer-otp` | admin |
| `POST` | `/admin/examens/approuver` | clinicien |
| `POST` | `/admin/examens/desapprouver` | clinicien |
| `GET` | `/patients`, `/patients/{code_patient}` | clinicien |
| `GET`/`POST` | `/suivis` | clinicien |
| `PATCH` | `/suivis/{id_suivi}` | clinicien |
| `GET` | `/triage?seuil_alerte_jours=` | clinicien (Vague 2) |
| `GET` | `/recommandations/{id_examen}` | clinicien (Vague 2) |
| `POST` | `/examens/{id_examen}/partager` | clinicien (Vague 2) |
| `GET` | `/protocole` | clinicien (Vague 2) |
| `GET` | `/poste/synthese` | clinicien — **un seul agrégat** pour tout le tableau de bord du poste |
| `GET`/`POST` | `/acces-resultat` | patient (OTP) |

Format d'erreur à respecter : `{"detail": "..."}`. Le front le lit via
`messageErreurApi()` — **ne jamais renvoyer du texte libre hors du champ `detail`**.

### 5.1 Décision clinique (Vague 1)

Les deux routes de décision portent sur **`id_examen`**, jamais sur le patient :
approuver un dossier entier reviendrait à libérer aussi les examens que le
clinicien n'a pas regardés.

| Route | Corps | Effet |
|---|---|---|
| `POST /admin/examens/approuver` | `id_examen`, `note_clinique?` | journalise `approuve`, émet l'OTP **pour cet examen** (`otp_codes.id_examen`), le notifie |
| `POST /admin/examens/desapprouver` | `id_examen`, `motif_desaccord` (min 1 car.) | journalise `desapprouve`, met `otp_codes.revoque_le` sur tous les codes de l'examen |

Points non négociables :

- `validations_cliniques` est un journal **en ajout** : une réapprobation
  n'écrase pas le motif du désaccord précédent. L'état courant se lit dans
  `v_etat_validation` (ou `etat_validation()` côté Python).
- `sans_decision` est l'état par défaut : les ~1 000 diagnostics antérieurs ne
  sont **pas** rétro-activés, on ne fabrique pas une traçabilité qui n'a jamais
  existé.
- Une désapprobation **sans révocation des OTP** serait cosmétique : le code est
  permanent et réutilisable, le patient continuerait de lire le compte rendu
  rejeté. `verifier_otp()` refuse donc tout code révoqué.
- L'OTP est émis par `emettre_otp_pour_examen()`, qui rend `(code, id_otp)` :
  c'est cet `id_otp` que la validation référence, donc que la révocation atteint.
  `generer_et_stocker_otp()` est conservée pour le simple renvoi d'OTP admin.

---

### 5.2 File de triage et protocole (Vague 2)

`GET /triage` répond à la seule question du matin : *qu'est-ce qui attend une
décision, et depuis combien de temps ?* Trois points engagent :

1. **L'état de validation filtre la file.** Les examens `approuve` en sortent ;
   les `desapprouve` y restent avec leur motif, parce qu'un désaccord doit
   pouvoir être relu. `sans_decision` est l'état par défaut des ~1 000
   diagnostics antérieurs.
2. **L'alerte est dérivée, jamais stockée.** Elle se recalcule à chaque lecture
   à partir du nombre de jours écoulés : une simple consultation n'écrit rien
   en base. Le seuil est borné à 0..60 jours, défaut 2.
3. **Approbation sans contact impossible.** `contact_disponible` vient de
   `EXISTS` sur téléphone/e-mail ; le front désactive le bouton plutôt que
   d'approuver un dossier dont l'OTP ne partira jamais.

`POST /examens/{id_examen}/partager` est plus strict encore :

- 409 si l'examen n'est pas `approuve` — on ne transmet pas par WhatsApp un
  résultat qu'un clinicien n'a pas arrêté ;
- 409 si le patient n'a pas de téléphone ;
- 409 si **aucun OTP actif n'a été émis** (`existe_otp_actif_patient`) : le
  message renvoie au portail en demandant d'utiliser le code de consultation,
  cette promesse n'est vraie que si un code non révoqué existe. L'émission
  peut avoir échoué à l'approbation (SMTP ou relais tombé) alors que la
  validation est déjà journalisée.

`GET /protocole` n'expose que de la charge de travail (volumétrie, décisions,
révocations, contrôles à venir, délai moyen). Latence et répartition Edge/Cloud
restent dans `/monitoring`, réservé à l'admin. Deux garde-fous :

- `taux_validation` vaut `null` dès qu'aucun examen n'est approuvé : afficher
  « 0 % » se lirait comme un indicateur de performance, alors que c'est l'absence
  de toute décision. La page affiche « — » ;
- base indisponible → **503**, jamais des compteurs à zéro. Un clinicien ne
  doit pas pouvoir conclure « file vide » à partir d'une panne.

Les agrégats viennent d'une seule requête (`v_protocole_validation`), pas d'un
comptage Python : un examen analysé entre deux appels fausserait le total.

**Portail patient — routage d'entrée (`/resultat`).** La page est **publique** :
c'est un code OTP, pas une session, qui identifie le patient. Le composant choisit
selon trois cas : `?otp=` présent → code pré-rempli ; aucune session → formulaire
de saisie ; session clinicien → compte rendu. Une session d'un *autre* rôle
(admin) est renvoyée vers sa page d'accueil, elle ne doit surtout pas voir le
formulaire patient.

⚠️ **Il y a deux gardes, et le second rattrape le premier.** `beforeLoad` (par
route) et `GardeAcheminement` dans `routes/__root.tsx`, qui relit
`ROLES_POUR_PREFIXE` après hydratation. Supprimer la garde `beforeLoad` de
`/resultat` n'a donc rien changé : tant que `/resultat` restait dans la table,
le garde racine renvoyait l'anonyme vers `/login`. C'était un cul-de-sac — le
lien de partage pointait sur une page exigeant un code dans l'URL, et aucun
message ne donnait ce code au moment du partage (il est haché en base, donc
irrécupérable). `/resultat` est donc **absent** de `ROLES_POUR_PREFIXE`, et la
vue clinicien est protégée dans le composant (`choisirVueResultat`).

Les liens des messages **OTP** (e-mail et WhatsApp) sont des liens magiques
`{url}/resultat?otp={code}` : le code y est en clair au moment de l'approbation.
Les deux voies doivent rester ouvertes.

`choisirVueResultat()` est une fonction **pure** exportée, volontairement
séparée du composant : une erreur de routage ne plante pas, elle renvoie
simplement le patient vers une page de connexion sans issue. C'est le seul point
du front où une erreur est silencieuse, donc le seul qui mérite d'être isolé et
testable.

**Portail patient — décision de produit (Vague 2).** Un code OTP n'ouvre
qu'un **unique** compte rendu : le dernier examen **approuvé**, pas le dernier
diagnostic. Un code permanent qui ouvrait le dossier d'un examen désapprouvé
aurait laissé le patient lire un compte rendu rejeté. Si aucun examen n'est
approuvé, la liste est vide — « rien de validé à vous communiquer » est un état
légitime, pas une panne. Conséquence assumée : un désaccord tardif retire au
patient l'accès à un examen antérieur validé, faute de critère de repli
raisonnable (une approximation serait pire qu'un retrait visible).

### 5.3 Tableau de bord du poste (`/poste`)

Un agrégat, une lecture. Six requêtes HTTP produiraient six instantanés du
même état, et deux chiffres du tableau de bord pourraient se contredire d'un
affichage à l'autre.

**L'unité de compte est l'examen, jamais le diagnostic.** La table `diagnostics`
compte les ré-analyses d'un même clichet : 1 010 lignes pour 25 examens, dont
947 le jour de la passe de charge des scénarios. Compter la série en analyses
afficherait un pic de 947 unités comme de l'activité du poste. Les verdicts
retenus sont ceux du **dernier** diagnostic de chaque examen ; l'unité du
graphique de répartition est le **verdict** (un examen donne un verdict de
tuberculose *et* un de pneumonie).

**La tuile « Charge et décisions » — deux aires cumulées.** Située entre
`BlocSuivis` et les deux cartes de lecture, elle est la seule qui réponde à « le
poste tient-il le rythme ? ». Deux séries, deux tons déjà porteurs d'un sens
sur la page : **bleu `#00b4d8`** = examens enregistrés (cumul), **ambre `warn`**
= décisions de validation (cumul). Le creux entre les deux aires est la file
non tranchée, lisible en thickness sans calcul.

Deux séries nouvelles, donc deux règles :

- **Cumul, jamais flux du jour.** Les séries brutes ne se recouvrent pas : les
  examens s'arrêtent au 26/09, les décisions commencent le 27/09, et aucun jour
  ne porte les deux. En flux, le graphique afficherait deux blocs séparés par
  une brèche et l'écart serait indécidable sur toute la période — la page
  répondrait « — » à sa propre question. Le cumul le supprime sans rien
  inventer : chaque point reste la somme de faits réellement enregistrés.
- **Aire droite (`type="linear"`), jamais `monotone`, et `connectNulls={false}`.**
  Le refus d'aire lissée posé plus bas dans `GraphiquesPoste.tsx` reste
  entier : un segment droit ne surestime rien, une courbe lisse dessine entre
  deux points des valeurs que personne n'a mesurées.

`decisions_par_jour` vient de `validations_cliniques.cree_le::date` : **aucune
migration, aucun changement de schéma**, la table portait déjà son horodatage.
Le comptage inclut les réapprobations après désaccord — c'est bien de la charge
du clinicien qu'on compte, pas l'état courant.

Cinq règles non négociables, toutes vérifiées par `tests/test_poste.py` :

1. **Aucun champ technique.** Ni destination Edge/Cloud, ni CPU, RAM, latence :
   ces indicateurs restent dans `/monitoring`, réservé à l'admin. Un test
   échoue dès qu'un nom de champ de la réponse contient l'un de ces mots.
2. **Aucun graphique sous 5 examens** (`SEUIL_EFFECTIF`). En dessous, la page
   affiche la liste et l'effectif : une barre unique ne dit rien et donne un
   poids visuel au hasard.
3. **Donut, jamais barre segmentée, pour la file de validation.** La barre
   donnait une longueur à un état dominant et une épaisseur illisible à un
   état minoritaire ; l'anneau met les parts en angle et son centre porte le
   chiffre qui presse (« à valider »). Le corps de la carte est une colonne
   flexible (`bodyClassName="flex flex-col"`) : l'anneau occupe l'espace,
   la légende et le texte descendent en bas de carte.
4. **Aucun pourcentage sans dénominateur.** Sans examen approuvé, la part
   validée vaut `null` et s'affiche « — », jamais « 0 % ».
5. **Base indisponible ≠ file vide.** 503 et écran d'état, pas des compteurs
   à zéro.

**Pas de rafraîchissement automatique**, contrairement à l'intuition : ces
compteurs changent quand un clinicien valide, donc à sa main. Un balayage
automatique les ferait clignoter sous les yeux de celui qui les lit — c'est la
même raison qui vaut à `/protocole` (voir `useProtocoleValidation`).

**La palette vient du dashboard administrateur, sauf le bleu et le rouge.**
Ambre et verts sont ceux de l'application : aucun token, aucune extension de
`primitives.tsx`, aucune teinte écrite en dur dans les graphiques Recharts. Le
bleu et le rouge sont les **teintes de marque du poste**, `#00b4D8` et
`#DB4437`, et elles n'existent que là.

Elles sont appliquées en surchargeant `--cloud` et `--alert` sur le seul
sous-arbre de la page :

```css
.poste-teinte {
  --cloud: #00b4d8;
  --cloud-soft: #e0f6fa;
  --alert: #db4437;
  --alert-soft: #fbe9e7;
}
```

Le `<div className="poste-teinte">` enveloppe le contenu de `/poste`, dans
`AppShell`. Comme les utilitaires compilent vers `var(--cloud)` et `var(--alert)`
(`@theme inline`), `text-cloud`, `bg-cloud`, `bg-cloud-soft`, `text-alert`,
`bg-alert`, `bg-alert-soft`, les bordures en opacité et les `fill` des
graphiques suivent automatiquement : **aucune de ces classes n'est dupliquée, et
`#00b4d8` comme `#DB4437` n'apparaissent qu'une fois dans toute la feuille de
style**. `:root` conserve les teintes d'origine, donc la sidebar, le badge de
rôle et `/dashboard` gardent les leurs.

⚠️ **Ne pas élargir ces deux hex sans les mesurer.** Sur le fond clair de la
page, `#00b4d8` plafonne à **2,4:1** — sous le seuil de 3:1, là où le bleu
d'origine tient 3,5:1. Il convient aux aplats (points, jauges, barres, cellules
de graphique) et aux libellés courts, pas à un paragraphe. `#DB4437` tient
**4,2:1**, contre 4,6:1 pour le rouge d'origine : le petit texte du `Tag`
d'alerte (mono 10 px) et la ligne « en retard » (11 px) restent lisibles, juste
sous le seuil AA de 4,5:1.

⚠️ **Sur ce rouge, « plus clair » ne veut pas dire « plus pâle ».** `#DB4437`
n'est pas un rouge délavé : sa teinte est passée de **357° à 5°**, donc plus
chaude et plus orangée que le `--alert` d'origine, pour une clarté presque
identique (54 %). C'est ce déplacement de teinte qui était demandé. Un
éclaircissement réel (`#E2695F`, 63 % de clarté) ne déplace pas la teinte —
4,6°, soit rien — et fait perdre un point de contraste : c'est un rouge plus
blanc, ce qui n'est pas le but. Les deux axes se confondent facilement dans une
demande de couleur ; les mesurer évite de se tromper de direction.

La correspondance des tons est sémantique :

| État clinique | Ton | Rappel |
|---|---|---|
| pathologie détectée, désaccord, retard au-delà du seuil | `alert` | rouge de marque `#DB4437` |
| aucun signal, examen validé | `ok` | vert « sain » |
| second avis requis, jamais analysé, pourcentage absent | `warn` | ambre « attention modérée » |
| file en cours, information | `cloud` | bleu de marque `#00b4D8` |

⚠️ **`--edge` est exclu, et c'est délibéré** : son orange
`oklch(0.72 0.16 63)` est indiscernable de l'ambre `--warn`
`oklch(0.72 0.15 70)`. Deux nuances que l'œil ne sépare pas sur un graphique,
et une couleur de *localisation* qui finirait à désigner un *état clinique*.
Le type partagé est `TonPoste` (`lib/poste.ts`).

Ce n'est qu'une contrainte de couleur, pas une fuite de métriques techniques :
`/poste` n'expose ni destination Edge/Cloud, ni CPU, RAM ou latence (règle 1
ci-dessus). Réutiliser le bleu du cloud comme teinte d'information ne
transforme pas une tuile en indicateur d'infrastructure.

## 6. Frontend : 17 routes, 2 rôles

| Route | Rôle | Contenu |
|---|---|---|
| `/` | public | landing page de présentation |
| `/login` | public | connexion admin/clinicien |
| `/dashboard` | admin | Mission Control, répartition Edge/Cloud, métriques |
| `/diagnostic` | clinicien | **console de triage** : patient, dépôt image, routage, progression |
| `/resultat` | public, clinicien | **portail patient** si aucune session ; compte rendu clinicien si session clinicien. `?otp=` pré-remplit le code |
| `/patients` | clinicien | dossiers patients, chronologie, comparaison n-1 / n |
| `/suivi` | clinicien | contrôles à venir, clôture « réalisé » / « annulé » |
| `/triage` | clinicien | **file de validation** (Vague 2) : du plus ancien au plus récent, alertes de retard, validation en un clic |
| `/poste` | clinicien | **tableau de bord du poste** : file, ancienneté, activité, verdicts, charge et décisions (deux aires cumulées), contrôles à venir. Une seule lecture (`/poste/synthese`), **rafraîchissement manuel** |
| `/protocole` | clinicien | **bilan de charge** (Vague 2) : volumétrie de la file, décisions, révocations, contrôles à venir |
| `/historique` | admin, clinicien | journal des inférences, filtres, recherche |
| `/monitoring` | admin | télémétrie CPU/RAM/réseau, santé des services |
| `/architecture` | admin | vue en couches (statique) |
| `/settings` | admin | seuils **en lecture seule** |
| `/admin` | admin | layout d'administration |
| `/admin/utilisateurs` | admin | comptes admin/clinicien |
| `/admin/patients` | admin | patients enregistrés, renvoi d'OTP |

⚠️ Il existe **deux** routes patients aux noms proches : `/patients` (dossier de soins,
**clinicien**, Vague 1) et `/admin/patients` (gestion des fiches, **admin**). Le
`AUDIT_PROJET.md` §2.5 nie l'existence de `/patients` : c'est lui qui se trompe.

**Stockage de session et de résultats :**

- JWT + profil utilisateur → `sessionStorage["aeris.session"]` (aucun cookie applicatif).
  Le choix est **délibéré** : le navigateur vide `sessionStorage` à la fermeture de
  l'onglet, donc toute nouvelle visite impose une authentification. Un rechargement
  (F5) conserve la session ; un second onglet doit se reconnecter. Une session
  résiduelle dans `localStorage` (version antérieure) est purgée à la 1ʳᵉ lecture.
- Résultat d'analyse d'un examen → **mémoire uniquement** (`resultat-store.ts`). Un
  rechargement de `/resultat` affiche donc un état vide ; c'est connu et non corrigé
  (§12). Le portail patient, lui, relit via OTP côté serveur et survit au rechargement.
  Le dossier transporte aussi `id_examen` et `id_patient` (Vague 1) : sans eux, la
  décision clinique n'a aucune cible et la programmation d'un suivi est refusée.
- **Code OTP patient permanent et réutilisable** : ni expiration
  (`expire_le` = `EXPIRE_LE_PERMANENT`, 31/12/2999) ni usage unique. Le patient
  revoit ses résultats autant de fois qu'il le souhaite. Rejets possibles : code
  inconnu, contact saisi n'appartenant pas au patient, 5 tentatives erronées
  (compteur remis à zéro dès un accès réussi), ou code **révoqué** par un désaccord
  clinique (Vague 1).

**Build :** `npm run build` → `.output/` (Nitro, preset `node-server`), servi par
`node .output/server/index.mjs` sur le port 3000. L'API est inlinée **au build** via
`VITE_URL_API` (défaut `http://localhost:8003`) : changer l'URL d'API exige un rebuild,
pas un redémarrage. `npm run dev` écoute sur **8080**.

⚠️ Le `.output/` présent sur le disque a été produit en preset `cloudflare-module`
(build local), pas en `node-server` : ce n'est pas le build qui tourne en Docker.

---

## 7. Persistance : deux vérités à connaître

`persistance.py` maintient le journal des diagnostics à **deux endroits** :

1. **Registre mémoire** (`registre_diagnostics.py`) — borné à 100 entrées
   (`CAPACITE_HISTORIQUE`), toujours à jour, sert aux compteurs temps réel.
2. **PostgreSQL** — source de vérité durable, lue par `/historique`,
   `/etat-systeme` et les vues `v_derniers_diagnostics` / `v_statistiques_globales`.

Règle : si la base est indisponible, le système **doit dégrader proprement** (ADR-0003) et
repli sur le registre mémoire, jamais planter ni mentir sur les chiffres. Toute nouvelle
statistique exposée au front doit donc avoir une source durable **et** son repli.

⚠️ L'écriture ne doit jamais bloquer une réponse : la persistance est best-effort.

---

## 8. Conventions

- **Nomenclature** : fichiers et dossiers en français, sauf noms imposés par les outils.
- **Python** : 3.11+, type hints, docstrings en français, `black` 100 colonnes, `ruff`
  (`E,F,W,I,N,UP`), quotes doubles.
- **TypeScript** : `strict: true` (plus `noUncheckedIndexedAccess` et
  `exactOptionalPropertyTypes` — les activer revient), ESLint + Prettier (100 colonnes).
- **Commits** : Conventional Commits **en français**.
- **Aucun commentaire** non demandé ; le code doit se lire seul.
- **Aucun secret en clair.** `JWT_SECRET` et `WHATSAPP_RELAY_SECRET` de `.env.example`
  sont des placeholders. `.env` n'est jamais commité ni cité.

---

## 9. Commandes de vérification

### Backend

**Le seul venv du dépôt est `services/moteur-decision/.venv`** (167 tests, tous verts).
Toujours se placer **dans** le dossier du service : chaque service est son propre paquet
`app`, donc pytest doit être lancé depuis sa racine.

```bash
# Moteur — 167 tests, seul env disponible
cd services/moteur-decision && .venv/bin/pytest tests/ -v

# Services IA — 5 tests chacun, AUCUN venv présent dans l'arbre de travail
# Ils ne sont donc pas exécutables en l'état : créer un env dédié si on doit y toucher.
cd services/service-tuberculose && python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/pytest tests/ -v          # idem pour services/service-pneumonie
```

Les tests IA ne couvrent que `/sante` (métriques cgroup) : ils exigent `numpy`, `pytest`,
`httpx` et `psutil`, **pas** TensorFlow. `requirements.txt` sert à l'inférence réelle
(`tensorflow==2.15.0`, installation lourde) — l'éviter pour une simple passe de tests.

⚠️ `pytest services/` depuis la racine **échoue** (`INTERNALERROR: No module named
'app.coeur'`) : la config `testpaths = ["services"]` de `pyproject.toml` entre en collision
avec les trois paquets `app` homonymes. Lancer pytest service par service.

### Frontend

```bash
cd tableau-de-bord
npx tsc --noEmit        # OBLIGATOIRE : pas de script "typecheck"
npm run lint            # ESLint (1 avertissement react-hooks connu sur `charger`)
npm run format          # Prettier --write
npm run build           # build SSR Nitro
```

Il n'existe **aucun test automatisé front** (ni Vitest, ni Jest, ni Playwright) : la
vérification du front passe par `tsc`, ESLint et le test manuel du flux.

### Expérimentations

```bash
docker compose --profile complet up -d
python experimentations/scenario-tout-cloud/executer.py
python experimentations/scenario-tout-edge/executer.py
python experimentations/scenario-adaptatif/executer.py
python experimentations/scenario-panne/executer.py
# Sortie : experimentations/resultats/<scenario>/{resultats-bruts.csv,statistiques.json,rapport.txt}
```

### Règle absolue

**Une modification n'est terminée qu'après avoir exécuté les tests concernés** et, pour le
front, `npx tsc --noEmit`. Ne pas déclarer « ça devrait marcher ».

---

## 10. Interdits et pièges

**Interdits :**

1. ❌ Introduire une **valeur par défaut fictive** (latence, CPU, RAM, santé de service) :
   le front affiche `indisponible` plutôt qu'un mensonge. C'est une décision d'architecture.
2. ❌ `git reset --hard`, `git checkout .`, `git clean` — 49 fichiers modifiés sont le
   travail en cours d'une session antérieure.
3. ❌ Modifier `tableau-de-bord/src/components/ui/` (shadcn généré) et
   `tableau-de-bord/vite.config.ts` hors du bloc `server.entry` : la config vient du preset
   `@lovable.dev/vite-tanstack-config`.
4. ❌ Modifier le SQL d'`infrastructure/postgres/init/` sans `persistance.py` et sans
   migration Alembic correspondante.
5. ❌ Toucher aux scripts `sudo` (`configurer-tunnel.sh`, `installer-maintien-tunnel.sh`,
   systemd) sans demande explicite : ils écrivent dans `/etc` et `/usr/local/sbin`.
6. ❌ Exécuter un `DELETE`/`TRUNCATE` en base de développement sans validation explicite de
   l'utilisateur (le nettoyage du 27/09/2026 a été fait sur demande, avec sauvegarde).
7. ❌ Commiter des `.keras`, `.env`, CSV d'expérimentation ou données radiologiques.
8. ❌ Divulguer le contenu de `.claude/settings.json` (il contient un jeton d'outil
   local) ou de `.env`.

**Pièges connus (vérifiés, non bloquants pour un travail courant) :**

- `MEMORY.md` pointe vers `memory/pas-attribution-ia.md` — **lien mort**, le dossier
  n'existe pas.
- Le `.gitignore` bloque `.keras`, `.env` et les données radiologiques : ne pas contourner
  avec `git add -f` pour « sauver » un modèle ou un secret.
- Le motif `.gitignore` `experimentations/resultats/*.csv` ne couvre pas le premier
  niveau : les CSV réels (`resultats/<scenario>/*.csv`) **sont suivis par git**.
- `infrastructure/postgres/init/05-seed.sql` initialise `seuil_cpu = 75` alors que
  `.env.example` et le compose utilisent `80`.
- `demarrage.sh` affiche des ports Cloud même en profil `edge`.
- `configurer-tunnel.sh` (avec nginx, port 8080) et `assurer-tunnel.sh` (sans nginx,
  mapping Funnel `/api`) décrivent deux déploiements différents ; le second est l'actuel.
- `src/routes/resultat.tsx` appelle `window.location.origin + "/api/…"`. Il n'existe
  **aucun proxy `/api`** dans Vite, Nitro ou le compose : ce chemin ne fonctionne qu'en
  exposition publique (nginx/Funnel). En dev, utiliser `VITE_URL_API`.

---

## 11. Fiabilité de la documentation existante

Toutes ces données ont été **vérifiées dans le code**. En cas de divergence, le code fait
foi et cette section doit être mise à jour.

| Document | Fiabilité |
|---|---|
| `AGENTS.md` (ce fichier) | ✅ à jour au 27/09/2026 |
| `AUDIT_PROJET.md` | ⚠️ incomplet : §1.2 annonce React 18 / Vite 5 / Tailwind 3 alors que le code est React 19.2 / Vite 8.1.5 / Tailwind 4 / TanStack Start SSR / jsPDF 4 ; §2.5 cite `/patients` (inexistante) ; §5.1 cite 3 rôles `admin/medecin/technicien` alors que le code n'a que `admin` et `clinicien` |
| `README.md` | ⚠️ dit « React 18, Vite », ne liste que 3 scénarios (il y en a 4), n'indique pas le port 8080 |
| `documentation/synthese-comprehension-projet.md` | ❌ daté 2026-09-10, s'auto-déclare « en attente de validation » : SQLite, un seul ADR, `PageAccueil`/`PageHistorique` non branchés — tout est périmé |
| `documentation/architecture.md` | ✅ utile pour le flux, à compléter sur l'OTP/patient |
| `documentation/journal-decisions/` | ✅ 4 ADR acceptés, faire foi |
| `documentation/rapport_experimentation.md` | ✅ résultats mesurés des 4 scénarios |
| `CLAUDE.md` | ✅ cadrage projet ; ignoré par git |

---

## 12. État actuel et risques ouverts

**Ce qui fonctionne et est vérifié :** routage strict Edge/Cloud, second avis par escalade
de confiance, flux patient complet (code auto, recherche par téléphone, OTP e-mail et
WhatsApp, PDF), historique durable PostgreSQL, RBAC à 2 rôles, métriques cgroup,
Prometheus, 4 scénarios d'expérimentation, 115 tests backend (105 moteur exécutables
+ 5 par service IA, qui nécessitent un env dédié absent de l'arbre de travail).

**Risques ouverts, par ordre de gravité :**

1. **🔴 Clinique — faux négatifs TB.** `Tuberculosis-109.png` est renvoyé *tuberculose
   absente, confiance 1,0* par le modèle Cloud. Le modèle est binaire, non calibré, et la
   confiance n'est pas une probabilité. Un `IM-0021-0001.jpeg` pourtant norma l'est aussi
   classé pneumonie à 98 %. Aucun déploiement clinique ne doit être envisagé sans
   recalibrage, seuil de sécurité et revue radiologique.
2. **🟠 Fraîcheur du refresh token.** Le claim `type` est bien émis (`acces` /
   `rafraichissement`) et `/auth/rafraichir` le vérifie, mais `decoder_jwt()` ne
   contrôle que signature et `exp`, et `exiger_authentification()` n'examine pas
   `type` : un refresh token reste donc accepté comme Bearer sur toutes les routes
   protégées, avec une durée de vie plus longue que celle d'un access token.
3. **🟠 Sécurité.** `CORS="*"`, `/metrics` non protégé, aucun rate limiting, secrets de
   développement par défaut à révoquer.
4. **🟠 Schéma.** Le Dockerfile du moteur ne copie ni n'exécute Alembic ; la base est
   initialisée par `persistance.py` (schéma embarqué), pas par les migrations — deux
   sources de vérité à réconcilier.
5. **🟡 Connexion WhatsApp.** Pas de session QR valide : le relais démarre mais n'envoie
   rien. Le canal e-mail fonctionne.
6. **🟡 UX.** Le résultat d'analyse est perdu au rechargement F5 de `/resultat`.
7. **🟡 Performance.** `/historique` renvoie 100 diagnostics toutes les 5 s par défaut
   (200 sur la page dédiée, 10 s) : le payload est lourd et perfectible.
8. **🟡 Outillage.** Absence de tests front, doublon de lockfiles (`bun.lock` +
   `package-lock.json`), deux modes d'exposition publique documentés en parallèle.

---

## 13. Checklist avant de proposer une modification

1. `git status` — identifier les modifications déjà en cours et ne pas les écraser.
2. Lire le fichier concerné **et** ses appelants, plus ses tests.
3. Vérifier la phase de lecture ci-dessus pour le sous-système touché.
4. Vérifier la compatibilité avec les 4 ADR et le format d'erreur `{"detail": ...}`.
5. Modifier le plus petit périmètre possible, en français, sans commentaire superflu.
6. Exécuter les tests concernés **et** `npx tsc --noEmit` si le front est touché.
7. Ne pas annoncer de succès sans sortie de commande à l'appui.
8. Si un doute subsiste sur l'intention ou le périmètre : **demander**, ne pas deviner.
