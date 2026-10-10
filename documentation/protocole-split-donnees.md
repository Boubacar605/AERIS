# Protocole de split et de calibration

> Ce document fixe la repartition des donnees et la maniere de mesurer la
>fiabilite des confiances. Il existe parce que la repartition historique de
> AERIS n'est pas reconstructible : le notebook TB Cloud a appele
> `os.listdir()` puis `random.sample()`, et l'ordre d'une liste de
> `os.listdir()` n'est pas specifie par Python. Les 4200 images ont donc ete
> reparties au hasard **et** forgets. Aucun membre du test historique n'est
> identifiable apres coup, et l'evaluation rapportee dans le notebook n'est pas
> rejouable.

## 1. Regle de base : un manifeste, pas un tirage

Aucune repartition ne doit plus etre produite par un tirage en memoire. Chaque
lot est ecrit dans un **manifeste CSV versionne** qui associe, pour chaque
image, son chemin, son SHA-256 et son etiquette. Trois proprietes en decoulent :

- **Rejouabilite** : le manifeste suffit a reconstituer un lot sans rerun
  d'entrainement, donc une metrique publiee est verifiable.
- **Detection de derive** : le SHA-256 detecte qu'une image a ete remplacee ou
  corrigee en amont du split, ce qui invaliderait silencieusement une
  evaluation anterieure.
- **Securite contre l'apprentissage** : le test est materialise dans un fichier
  que l'entrainement lit explicitement, donc son absence dans les lot
  d'entrainement est verifiable et non presumee.

Le manifeste est versionne dans git (il ne contient que des chemins, des
empreintes et des etiquettes, aucune donnee radiologique, cf. `.gitignore`).

### 1.1 Contenu d'un manifeste

```csv
lot,chemin_relatif,sha256,etiquette
entrainement,Images/Background_chn/chn1.png,3f7a...,0
validation,Images/Tuberculosis/tb1.png,a91c...,1
```

`etiquette` vaut 1 pour la classe positive de la pathologie du lot, 0 sinon.
Pour un lot multi-label, un manifeste par pathologie.

## 2. Determinisme

Trois ingredients, tous explicites :

1. **Tri prealable.** La liste des chemins est triee lexicographiquement avant
   tout tirage. C'est ce qui supprime la dependance a l'ordre du systeme de
   fichiers, seule cause de la perte historique.
2. **Graine fixe et ecrite.** Un seul parametre, declare dans le manifeste et
   dans le notebook qui l'a produit.
3. **Echantillonnage en deux temps.** Tirage de l'entrainement, puis tirage du
   test parmi le complement, puis tirage de la validation parmi le test
   restant. Cet ordre garantit qu'un lot est toujours inclus dans un autre
   uniquement par construction, jamais par un `if` disperse.

Aucun `python -c` ne doit produire un lot. Le generateur est un script du depot.

## 3. Repartitions

### 3.1 Pneumonie — jeu Mooney, repartition d'origine conservee

| Lot | Effectif | Provenance |
|---|---|---|
| Entrainement | 5 216 | `chest_xray/train` |
| Validation | 16 | `chest_xray/val` |
| Test | **624** | `chest_xray/test` |

**Cette repartition n'est pas regeneree.** C'est un choix delibere, pour trois
raisons :

- elle est publiee et documentee, donc opposable ;
- les deux modeles v1 (Edge et Cloud) ont ete entraines exactement dessus, donc
  la calibration des deux est directement comparable aux metriques rapportees
  par les notebooks d'origine (92,63 % pour l'Edge) ;
- le lot de test de 624 images **n'a servi ni a l'entrainement ni au choix
  d'epoch** dans aucun des deux notebooks. C'est le seul hold-out propre dont
  nous disposons sur ce projet.

Il n'y a donc **rien a reentrainer pour calibrer la pneumonie**. Le lot commun
existe deja pour la pneumonie ; seule la TB en est depourvue.

### 3.2 Tuberculose — pool commun 4 200, repartition 80/10/10

| Lot | Effectif | Cle |
|---|---|---|
| Entrainement | 3 360 | `tuberculose_entrainement` |
| Validation | 420 | `tuberculose_validation` |
| Test | 420 | `tuberculose_test` |

Les quotas reproduisent **volontairement** le split historique du notebook TB
Cloud (3 360 / 420 / 420) : les resultats du nouveau modele sont alors
comparables a la valeur historique, ce qui est le seul point de comparaison
possible puisque l'appartenance exacte des images de l'ancien test est perdue.

Les 4 200 images du pool proviennent de `tawsifurrahman/tuberculosis-tb-chest-xray-dataset`,
qui agrege Shenzhen, Montgomery et d'autres collections. Ce pool **n'est pas
homogene** a un scanner unique : le modele doit donc etre evalue sur la
distribution qu'il verra reellement, ce qui est l'objet du test, pas un
defaut a contourner.

**Les deux couches partagent ce pool, avec le meme manifeste.** L'Edge
s'entraine sur une version legere (96x96, ~40 tours) et le Cloud sur DenseNet121
(320x320, plus de tours) : c'est la contrainte de ressources qui doit
differencier les deux modeles, pas les donnees. Deux jeux differents
rendraient toute comparaison de latence et de qualite ininterpretabile.

### 3.3 Limite assumee : aucune source TB independante

Aucune source publique independante des collections Shenzhen / Montgomery /
Belarus / NIAID / RSNA n'a ete identifiee. Les jeux multi-classes disponibles
sur Kaggle sont des derives des memes collections. Il n'existe donc **pas** de
jeu de test TB transversal independant, et il serait malhonnete d'en pretendre
un.

La validation repose en consequence sur trois instruments distincts, dont
chacun a une limite :

| Instrument | Ce qu'il etablit | Limite |
|---|---|---|
| Hold-out 420 par modele | Calibration, choix d'epoch, seuil operatoire | Meme distribution que l'entrainement |
| Sonde multi-label TB x PN par relecture | Coherence des deux diagnostics sur une meme image | Faible effectif, annotation humaine |
| Jeu legacy 20 images | Detecte un memorize, pas une generalisation | Hors distribution, n'est pas un jeu de performance |

## 4. Conventions de sortie : la table qui n'existait pas

Les quatre modeles n'exposent pas la meme chose sous le nom `confiance`, et
**deux d'entre eux ont des conventions opposees**. Une valeur `0.3` signifie
« 30 % de chance de pneumonie » sur un modele et « 30 % de chance d'etre sain »
sur l'autre. Sans table, la calibration d'un modele consiste a renommer sa
probabilite complementaire et a conclure qu'il est dramatiquement mal calibre.

| Modele | Sortie brute | `P(classe positive)` | Source |
|---|---|---|---|
| `tb_edge` (v3) | softmax 2 | `p[1]` | `interpreter_prediction` |
| `tb_cloud` (v1) | sigmoid | `s` | `interpreter_prediction` |
| `pn_edge` (v3) | sigmoid | `s` | `interpreter_prediction` |
| `pn_cloud` (v1) | sigmoid | `s` | `interpreter_prediction` |

**Le cas `pn_edge` a change avec la bascule Edge v3 du 09/10/2026.** Le modele
Edge v1 sortait `P(NORMAL)`, d'ou la conversion `1 - s` ; le modele Edge v3 sort
`P(PNEUMONIE)` directement, comme le Cloud. La table ci-dessus decrit l'etat
**deploye**. Les scores v1 deja collectes restent valides : `collecteur_scores.py`
deduit `P(pathologie)` de `prediction` et `confiance`, jamais d'une orientation
declaree.

`experimentations/communs/calibrage.py` porte cette table sous le nom
`ORIENTATIONS`, et `test_calibrage.py` verifie que chaque conversion est correcte.
Toute modification de `interpreter_prediction()` dans les services doit entrainer
une modification de cette table, sinon les tests doivent echouer.

## 5. Mesurer la calibration

`calibrage.py` implemente le diagnostic avant la correction :

- **pente et ordonnee** (`ajuster_platt`) : ajustement
  `logit(p) = a + b * logit(p_hat)`. Ce sont elles, et non la temperature, qui
  *diagnostiquent*. `b < 1` = exces de confiance. `b = 1, a != 0` = biais de
  base, que le temperature scaling seul ne corrigerait pas.
- **temperature** (`ajuster_temperature`) : un seul scalaire applique au
  logit, justifiee seulement si l'intervalle de bootstrap exclut `T = 1`.
- **Brier et NLL** : metriques primaires, ce sont des *proper scoring rules*.
- **ECE** : complementaire seulement, elle depend du nombre de tranches, qui
  est donc toujours rapporte avec elle.

Le repli isotonique n'est volontairement pas fourni : il sureajuste sous
quelques centaines d'echantillons et produirait une courbe de fiabilite
decrivant l'echantillon de calibration plutot que la loi du modele.

### 5.0 La precision de sortie peut rendre le calibrage non identifiable

Constat mesure sur le hold-out Mooney de 624 images, avant toute correction.

Le service renvoie `round(confiance, 4)`, mais augmenter ce nombre de decimales
ne resout rien : la saturation est **anterieure a l'arrondi**. Le modele
tourne en `float32`, ou `sigmoid(logit)` vaut exactement `1.0` des que le
logit depasse environ 16. Le logit est donc detruit a l'interieur du modele, et
aucune precision d'affichage ne peut le recuperer.

| Couche | Predictions a exactement 1.0 | Temperature sur tout | hors queue saturee | sur queue saturee |
|---|---|---|---|---|
| PN Edge | **192 / 624 (31 %)** | 2,60 | 1,62 | 7,18 |
| PN Cloud | 69 / 624 (11 %) | 2,38 | 2,38 | non estimable |

L'amplitude de 1,62 a 7,18 selon le sous-ensemble tudit la temperature de l'Edge
comme **non identifiable**. Rapporter 2,60 sans cette reserve serait faux.

La queue saturee de l'Edge contient 188 vrais positifs sur 192 : ce sont des
malades que le modele declare certains au point de saturer, ce qui est
exactement le comportement d'un reseau surconfiance. Ce n'est donc pas un
artefact de mesure, c'est le phenomene etudie.

Consequence de methode : une temperature n'est rapportable que si elle est
**stable sur sous-ensembles**. L'instabilite doit etre signalee comme un
resultat, pas corrigee en ajustant la methode jusqu'a obtention d'un chiffre
plaisant. Pour rendre l'Edge identifiable, il faut soit exposer le logit
avant sigmoid, soit reinferer en `float64` ; ce sont des modifications de
l'API d'inference, donc des decisions d'architecture, pas des reglages.

### 5.1 Ce que le recalibrage ne fait pas

Le temperature scaling est une transformation **monotone croissante** : aucune
classification n'est changee. Rappel, specificite, precision et courbe ROC
d'un modele sont **rigoureusement identiques** avant et apres. Seul le seuil sur
l'echelle de probabilite se deplace.

Il ne faut donc pas annoncer une amelioration de l'AUC, ni comparer un seuil
avant recalibrage a un seuil apres : ils ne vivent pas sur la meme echelle. Le
benefice est que la confiance devient **exprimable** — un seuil regle pour
rappel 90 % veut enfin dire rappel 90 %.

### 5.2 Seuil operatoire : derive, jamais 0,5

`seuil_pour_rappel` ne propose pas 0,5 par defaut. Le seuil est derive d'une
exigence de rappel, parce qu'une pathologie non detectee est le pire echec dans
un parcours de triage. La precision resultante est un cout assume, pas un
defaut du modele.

Le seuil de rappel retenu est **0,90** :

- pour la tuberculose, ce n'est pas un choix : le *Target Product Profile* de
  l'OMS pour un test de depistage TB exige une sensibilite d'au moins 90 % ;
- pour la pneumonie, **il n'existe aucun TPP de l'OMS** pour un CAD sur
  radiographie. Le seuil de 0,90 est donc repris **par analogie** au cas TB, et
  cette absence de reference est une limite a assumer dans toute publication,
  pas un detail a passer sous silence.

Un seuil recale modifie `seuil_confiance_escalade`, `SEUIL_INDETERMINE` et
`SEUIL_NORMAL_CONFIANT`. Ces constantes ne doivent donc **pas** etre rederivees
a la main : elles sont produites par le calibrage et reportees dans la
configuration, avec la valeur de temperature associee.

## 6. Pieges rencontres en production des modeles v2

Trois problemes rencontres pendant la mise en place des notebooks hors ligne.
Aucun n'est une propriete des modeles : les trois viennent de l'outillage, et
chacun aurait produit un chiffre faux silencieusement.

### 6.1 Un arrondi de sortie peut inventer une pathologie du modele

`adaptateur_predictions.py` ecrivait initialement la probabilite avec six
decimales. Sur `tb_edge_v2`, qui descend jusqu'a **1,5e-20** sur ses negatifs,
cet arrondi produisait 74 zeros exacts. La calibration voyait alors une
saturation que le modele ne produit pas, et la NLL ne concordait plus avec
celle du notebook (0,12252 attendu, obtenu par une autre voie).

La correction est l'ecriture en pleine precision (`%.17g`), verrouillee par
`test_queue_de_distribution_non_ecrasee`. Le principe general : **un artefact
d'outil ne doit jamais etre rapporte au modele**, et la premiere reaction
devrait etre de douter de l'outil avant le modele.

### 6.2 Deux copies d'un manifeste ne sont pas deux fois le meme split

Le code de decouverte des manifestes faisait
`next(c for c in candidats if c.name == nom)` sur un `glob` recursif : le
premier trouve gagne. Un `experimentations/manifestes/experimentations/manifestes/`
restait d'une execution ou `--sortie` avait ete passe par erreur, et contenait
un split **divergent** : 60 positifs au test au lieu de 75, 39 chemins en
commun sur 420. Aucun message n'aurait signalé la divergence.

Deux corrections : le doublon a ete supprime, et les notebooks TB leveient
maintenant `RuntimeError` si deux manifestes de meme nom ont des SHA-256
differents, au lieu d'arbitrer silencieusement. Le dossier racine `manifests/`
etait la seconde copie, identique octet pour octet, et a ete supprime au
profit du seul emplacement canonique `experimentations/manifestes/`.

### 6.3 Kaggle ne permet pas de changer la licence d'un dataset

Le dataset `boubaniang/aeris-tb-manifests` est publie en **CC0-1.0**, ce qui
affirme « aucune reserve » sur des donnees derivees d'un corpus IEEE Access.
La correction en **CC BY 4.0** a ete tentee deux fois, via
`kaggle datasets version` puis via `kaggle datasets metadata --update` : le
titre, le sous-titre et la description se sont mis a jour, **`licenses` est
reste a CC0-1.0**. Le champ est immuable apres creation.

Deux consequences a assumer :

- l'obligation d'attribution est portee par la **description**, qui contient le
  DOI `10.1109/ACCESS.2020.3031384` et la mention explicite qu'aucune image n'est
  redistribuee ;
- le dataset est **prive**, donc l'etiquette CC0-1.0 n'est visible que par son
  proprietaire.

Corriger vraiment demanderait de supprimer et recreer le dataset, ce qui
changerait son identifiant et casserait les `dataset_sources` des kernels. Ce
n'est pas un nettoyage, c'est une decision a arbitrer explicitement.

### 6.4 Une temperature « non estimable » doit etre non estimable, pas une borne

Constat sur `tb_cloud_v2`, ou les 420 predictions de test sont parfaitement
ordonnees (tout positif >= 0,9727, tout normal <= 0,0083).

Quand les deux classes sont deja separees, la vraisemblance est minimisee en
poussant `T` vers 0 : les probabilites partent vers 0 et 1, ce qui annule la
NLL. L'optimum est donc **sur la frontiere** de l'espace de recherche
(`1e-2 ... 1e2`), a `T = 0,0100`. L'outil le renvoyait en annonçant
« IC95 exclut 1.0 : True » et proposait un seuil operatoire de `1,0000` — un
seuil qui n'a aucun sens et « rapporterait » un rappel de 100 %.

Le meme piege se presente avec des logits non finis : avec `EPSILON = 1e-18`,
`logit()` produit `inf`, la NLL vaut `nan`, la section d'or se rabat sur sa
Le meme piege se presente avec des logits non finis : avec `EPSILON = 1e-18`,
`logit()` produit `inf`, la NLL vaut `nan`, la section d'or se rabat sur sa
borne basse, et le rapport annonçait encore « IC95 exclut 1.0 : True ».

Dans les deux cas l'outil produisait une **conclusion assertive et fausse**,
alors qu'il n'avait rien estime. C'est le pire defaut possible pour un outil de
calibration : il ne se contente pas de ne rien dire, il parle avec assurance.

`ajuster_temperature` leve désormais dans les deux cas, `estimer_ou_nan` evite
la propagation, `intervalle_bootstrap_temperature` tolere les tirages non
estimables, et `evaluer()` bascule sur le diagnostic
`temperature_non_estimable` avec `correction_retenue = "aucune"`. Dans ce cas
les colonnes « avant » et « apres » sont identiques **par construction** : rien
n'a ete applique, et le rapport le dit explicitement plutot que de presenter
deux lignes identiques sans explication.

Deux tests verrouillent ce comportement :
`test_logits_constants_refuses_car_la_temperature_n_est_pas_identifiable` et
`test_des_logits_non_finis_sont_refuses`.

**Le principe generalisable :** une valeur non estimee ne doit jamais etre
remplacee par une valeur par defaut. Ni zero, ni la borne de recherche, ni un
NaN presente comme un nombre. Une metrique de calibration absente doit se lire
« non estimee », pas « 0.01 ».

### 6.5 Une AUC parfaite peut mesurer le jeu de donnees, pas le modele

`tb_cloud_v2` obtient AUC = 1,000000 et Brier = 2,3e-06 sur les 420 images de
test. La separation est parfaite : max negatif 8,2796e-03, min positif
9,7267e-01, **zero inversion**.

Avant d'y croire, deux controles ont ete conduit sur les 4200 images montees
sur Kaggle (kernel `boubaniang/aeris-diag-fuite-tb`, SHA-256 + `dhash`).
Ils ont donne deux resultats qu'il faut **separer**, sinon on analyse le
mauvais probleme.

**1. Une fuite averee.** `Tuberculosis/Tuberculosis-243.png` (test) est
identique octet pour octet a `Tuberculosis/Tuberculosis-244.png` (train) :
meme SHA-256 `e6d26454...`. Les manifestes doivent etre regeneres avec
de-duplication sur SHA-256 ; en attendant, tous les scores TB sont des bornes
hautes.

**2. Cette fuite n'explique pas l'AUC de 1,0.** En retirant l'image fautive :

| Modele | AUC complet | AUC sans l'image qui fuit |
|---|---|---|
| `tb_cloud_v2` | 1,000000 | **1,000000** |
| `tb_edge_v2` | 0,973140 | 0,972777 |

La separation parfaite vient donc du **corpus**. Ce jeu de donnees ne presente
pas la difficulte d'un depistage reel, et l'AUC de 1,0 mesure cette
separabilite, pas une performance clinique. Aucun des quatre modeles ne peut
etre presente comme ayant une performance clinique etablie.

**3. Le « quasi-doublon » est un artefact du detecteur, pas une fuite.** Le
controle a trouve 234 513 paires a distance de `dhash` <= 5, dont 80 933 entre
lots. Ce chiffre ne veut rien dire : un `dhash` de 64 bits sur une
radiographie reduite a 8 x 8 ne distingue pas deux poumons norms (seules 3264
des 3500 images normales ont un `dhash` distinct). Un seuil correct
demanderait un descripteur de 64 x 64 ou un modele d'embeddings. **Seul le
doublon strict est exploitable**, et il faut le dire : annoncer « 6 % du jeu
fuit » a partir de ce nombre serait une faute d'analyse.

### 6.6 L'arrondi a quatre decimales rend des images indiscernables

Les services renvoient `round(confiance, 4)`. Ce n'est plus une question de
saturation mais de **resolution** :

| Modele | `p` affichees `0.0000` | `p` affichees `1.0000` | intermediaires |
|---|---|---|---|
| `pn_edge_v2` | 0 | 0 | 624 |
| `pn_cloud_v2` | 6 | 362 | 256 |
| `tb_edge_v2` | 171 | 3 | 246 |
| `tb_cloud_v2` | 333 | 70 | **17** |

Pour `tb_cloud_v2`, **403 des 420 predictions sont indiscernables** dans le
systeme. Ce n'est dit par aucune metrique d'evaluation, et la logique
d'escalade de confiance s'appuie pourtant sur cette valeur : elle ne peut pas
distinguer « le modele est sur » de « l'affichage a ateint sa grille ».

C'est la consequence operationnelle principale de toute l'etude, et elle vaut
pour les quatre modeles. Corriger demanderait d'exposer le logit avant sigmoid
ou de travailler en `float64` : ce sont des decisions d'architecture, pas des
reglages, et elles sont hors du perimetre de l'outillage de calibration.
