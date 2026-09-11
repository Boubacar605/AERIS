# ADR-0002 : Routage selectif par profilage d'image

## Statut

Accepte

## Contexte

Les images de depistage tuberculose (PNG, carrees, jeu Shenzhen/Montgomery) et de depistage pneumonie (JPEG, rectangulaires, jeu Kaggle Kermany) presentent des caracteristiques techniques distinctes. L'envoi systematique de chaque radiographie aux deux specialistes (TB et PN) provoque un signal errone hors domaine : le modele PN, entraine uniquement sur des cliches de pneumonie, voit toute anomalie pulmonaire TB comme de la pneumonie — et son verdict ecrase parfois celui du specialiste TB (cas concret : Tuberculosis-109.png → TB 100% negatif, PN 100% positif → verdict faux « PNEUMONIE DETECTEE »).

## Decision

Ajout d'une etape de profilage d'image (Pillow, lecture d'entete uniquement, ~1ms) avant l'inference, associee a des regles configurables qui ne sollicitent que les specialises dont le domaine correspond au profil de l'image.

Le routage selectif est le mode par defaut, avec un kill-switch (`profilage_active=False`) pour revenir au comportement historique. Un contexte clinique optionnel (`contexte` = "tuberculose" | "pneumonie" | "general") saisi par le soignant peut surclasser la regle automatique.

## Justification

- **Economies de ressources** : le modele ecarte ne recoit aucun appel reseau — pas d'inference, pas d'envoi d'image.
- **Fiabilite du verdict** : chaque specialiste ne traite que les images de son domaine, supprimant le signal hors-domaine.
- **Securite (repli)** : profil ambigu ou indécodable → les deux specialistes (comportement historique, jamais de verdict sacrifie).
- **Reproductibilite** : regles basees sur format + ratio, mesures sur 20 images de test — 20/20 routees correctement.
- **Traçabilite** : le filtrage (specialistes admissibles, regle appliquee, specialiste ecarte) est expose dans la reponse HTTP, l'historique, et le tableau de bord.
- **Configurabilite** : seuils et formats surchargeables par variables d'environnement, reutilisables sur d'autres jeux.

## Consequences

### Limites documentees

- Les regles par defaut sont calibrees sur les jeux de la demo (Shenzhen/Montgomery vs Kaggle Kermany) et restent configurables ; c'est l'architecture du profilage qui constitue la contribution.
- Une image au profil « trompeur » (p. ex. radiographie PN recadree en PNG carre) serait routee vers TB — risque attenue par le contexte clinique optionnel et par le repli « les deux » sur profils ambigus.
- Une co-infection TB+PN sur une image se profilant TB ferait manquer le signal PN — compromis assume (economies de ressources + fiabilite domaine), documente pour le jury.

### Impact technique

- Ajout de la dependance Pillow dans le moteur de decision (absente jusqu'ici).
- Correction d'un bug latent : la journalisation indexait `primaires[0]` / `primaires[1]`, provoquant un `IndexError` lorsqu'un seul specialiste est sollicite.
- Le filet de securite de confiance (escalade Edge <-> Cloud) est conserve et ne s'applique qu'aux pathologies effectivement sollicitees.
