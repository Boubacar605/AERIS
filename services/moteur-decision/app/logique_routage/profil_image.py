"""Profilage d'image et routage selectif des specialistes.

Une etape legere (lecture d'entete uniquement, pas de decodage pixel)
extrait les caracteristiques techniques d'une radiographie (format,
dimensions, ratio, canaux) puis, via des regles configurables, determine
quels specialistes doivent traiter l'image.

Objectif : eviter la reactivite croisee hors-domaine. Le modele pneumonie,
entraine uniquement sur des cliches de pneumonie, voit sa classe "normal"
contaminee par toute anomalie du poumon : sur une image tuberculose il
repond toujours et son verdict ecrase parfois le specialiste TB. Le
profilage ecarte le specialiste dont le domaine ne correspond pas a
l'image, economisant les ressources et fiabilisant les verdicts.

Table de decision (ordre strict de priorite) :
1. profilage desactive (kill-switch)   -> les deux specialistes
2. contexte "tuberculose"              -> TB seul
3. contexte "pneumonie"                -> PN seul
4. contexte "general"                  -> les deux
5. profil indecodable / incomplet      -> les deux (securite)
6. PNG carre (ratio ~1.0)              -> TB seul (profil tuberculose)
7. JPEG etire (ratio >= 1.1)           -> PN seul (profil pneumonie)
8. sinon (profil ambigu)               -> les deux (securite)

Jamais de regle basee sur le niveau de gris seul : l'image de reference
Tuberculosis-109.png est en niveaux de gris ET appartient au domaine TB.
"""

import io
from typing import Any

from PIL import Image
from pydantic import BaseModel

from app.schemas.schemas_routage import FiltrageSpecialistes, ProfilImage

SPECIALISTES_TOUS = ["tuberculose", "pneumonie"]
"""Les deux pathologies prises en charge par le systeme (dans l'ordre affiche)."""


class ReglesProfilage(BaseModel):
    """Seuils et formats utilises par les regles de profilage.

    Passe en argument de ``appliquer_regles`` pour garder le module pur
    et testable sans dependre de l'environnement du moteur.
    """

    seuil_ratio_carre_inf: float = 0.9
    seuil_ratio_carre_sup: float = 1.1
    seuil_ratio_pn: float = 1.1
    format_image_tb: str = "PNG"
    format_image_pn: str = "JPEG"
    profilage_active: bool = True


def construire_profil(contenu: bytes, nom_fichier: str | None = None) -> ProfilImage:
    """Extrait le profil technique de l'image depuis l'entete du fichier.

    La lecture se limite a l'entete (format, dimensions, mode) sans décoder
    les pixels : l'analyse reste leger (~1ms) et convient pour un triage.
    En cas de fichier illisible ou non image, retourne un profil
    ``indecodable=True`` (le repli "les deux specialistes" s'applique alors).
    """
    if not contenu:
        return ProfilImage(nom_fichier=nom_fichier, indecodable=True, taille_octets=0)

    try:
        with Image.open(io.BytesIO(contenu)) as image:
            # Vérifie l'intégrité du fichier sans charger les pixels en mémoire.
            image.verify()

        with Image.open(io.BytesIO(contenu)) as image:
            format_img = image.format.upper() if image.format else None
            largeur, hauteur = image.size
            mode_canaux = image.mode
            ratio = round(largeur / hauteur, 3) if hauteur else None
    except Exception:
        return ProfilImage(
            nom_fichier=nom_fichier,
            indecodable=True,
            taille_octets=len(contenu),
        )

    return ProfilImage(
        nom_fichier=nom_fichier,
        format=format_img,
        largeur_px=largeur,
        hauteur_px=hauteur,
        ratio_largeur_hauteur=ratio,
        mode_canaux=mode_canaux,
        taille_octets=len(contenu),
        indecodable=False,
    )


def _regle_ecart(
    profil: ProfilImage,
    regles: ReglesProfilage,
) -> FiltrageSpecialistes:
    """Cible le specialiste TB : PNG carre (depistage tuberculose)."""
    ratio = profil.ratio_largeur_hauteur
    return FiltrageSpecialistes(
        profil=profil,
        specialistes_admissibles=["tuberculose"],
        regle_appliquee="Profil tuberculose (PNG carre)",
        cle_regle="profil_tb",
        specialiste_ecarte="pneumonie",
        raison=(
            "Format PNG, carre "
            f"(ratio {ratio:.2f}) -> profil de depistage tuberculose "
            "(Shenzhen/Montgomery). Modele pneumonie non sollicite pour "
            "eviter la reactivite croisee sur lesions tuberculeuses."
        ),
    )


def _regle_pn(
    profil: ProfilImage,
    regles: ReglesProfilage,
) -> FiltrageSpecialistes:
    """Cible le specialiste PN : JPEG etire (cliches de pneumonie)."""
    ratio = profil.ratio_largeur_hauteur
    return FiltrageSpecialistes(
        profil=profil,
        specialistes_admissibles=["pneumonie"],
        regle_appliquee="Profil pneumonie (JPEG etire)",
        cle_regle="profil_pn",
        specialiste_ecarte="tuberculose",
        raison=(
            "Format JPEG, rectangle etire "
            f"(ratio {ratio:.2f}) -> profil de depistage pneumonie "
            "(Kaggle Kermany). Modele tuberculose non sollicite : les "
            "caracteristiques de l'image ne correspondent pas a son domaine."
        ),
    )


def appliquer_regles(
    profil: ProfilImage,
    contexte: str | None,
    regles: ReglesProfilage,
) -> FiltrageSpecialistes:
    """Applique la table de decision pour determiner les specialistes admissibles.

    Le contexte clinique optionnel prime sur la regle automatique de
    profilage. Le repli "les deux specialistes" est applique des que le
    profil est indecodable, incomplet ou ambigu (securite).
    """
    # 1. Kill-switch : le profilage est desactive, comportement historique.
    if not regles.profilage_active:
        return FiltrageSpecialistes(
            profil=profil,
            specialistes_admissibles=SPECIALISTES_TOUS,
            regle_appliquee="Profilage desactive (kill-switch)",
            cle_regle="profilage_desactive",
            specialiste_ecarte=None,
            raison=(
                "Le profilage d'image est desactive par configuration : "
                "les deux specialistes sont sollicites (comportement historique)."
            ),
        )

    # 2. Contexte clinique : surclasse la regle automatique.
    if contexte == "tuberculose":
        return FiltrageSpecialistes(
            profil=profil,
            specialistes_admissibles=["tuberculose"],
            regle_appliquee="Contexte clinique : depistage tuberculose",
            cle_regle="contexte_tuberculose",
            specialiste_ecarte="pneumonie",
            raison=(
                "Contexte clinique tuberculose indique par le soignant : "
                "specialiste TB seul sollicite, modele pneumonie ecarte."
            ),
        )
    if contexte == "pneumonie":
        return FiltrageSpecialistes(
            profil=profil,
            specialistes_admissibles=["pneumonie"],
            regle_appliquee="Contexte clinique : depistage pneumonie",
            cle_regle="contexte_pneumonie",
            specialiste_ecarte="tuberculose",
            raison=(
                "Contexte clinique pneumonie indique par le soignant : "
                "specialiste PN seul sollicite, modele tuberculose ecarte."
            ),
        )
    if contexte == "general":
        return FiltrageSpecialistes(
            profil=profil,
            specialistes_admissibles=SPECIALISTES_TOUS,
            regle_appliquee="Contexte clinique general : bilan complet",
            cle_regle="contexte_general",
            specialiste_ecarte=None,
            raison=(
                "Contexte clinique general indique par le soignant : "
                "bilan des deux pathologies (TB + PN)."
            ),
        )

    # 3. Profil incomplet ou illisible : repli securitaire sur les deux.
    if profil.indecodable or profil.format is None or profil.ratio_largeur_hauteur is None:
        return FiltrageSpecialistes(
            profil=profil,
            specialistes_admissibles=SPECIALISTES_TOUS,
            regle_appliquee="Profil indecodable ou incomplet : repli securitaire",
            cle_regle="profil_indecodable",
            specialiste_ecarte=None,
            raison=(
                "Le profil de l'image est indecodable ou incomplet : "
                "les deux specialistes sont sollicites pour ne pas "
                "sacrifier de verdict (repli securitaire)."
            ),
        )

    # 4. Regles par defaut basees sur format + ratio.
    ratio = profil.ratio_largeur_hauteur
    if (
        profil.format == regles.format_image_tb
        and regles.seuil_ratio_carre_inf <= ratio <= regles.seuil_ratio_carre_sup
    ):
        return _regle_ecart(profil, regles)

    if (
        profil.format == regles.format_image_pn
        and ratio >= regles.seuil_ratio_pn
    ):
        return _regle_pn(profil, regles)

    # 5. Profil ambigu (aucune regle ne correspond) : les deux.
    return FiltrageSpecialistes(
        profil=profil,
        specialistes_admissibles=SPECIALISTES_TOUS,
        regle_appliquee="Profil ambigu : les deux specialistes",
        cle_regle="profil_ambigue",
        specialiste_ecarte=None,
        raison=(
            "Les caracteristiques de l'image ne correspondent a aucun profil "
            "univoque : les deux specialistes sont sollicites pour ne pas "
            "sacrifier de verdict (repli securitaire)."
        ),
    )