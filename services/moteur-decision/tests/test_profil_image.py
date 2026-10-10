"""Tests des fonctions pures de profilage d'image et de routage selectif.

Couvre ``construire_profil`` (extraction legere des caracteristiques de
l'entete) et ``appliquer_regles`` (table de decision des specialistes
admissibles), y compris le repli securitaire sur les deux modeles et la
surclasse du contexte clinique.
"""

import io

from app.logique_routage.profil_image import (
    ReglesProfilage,
    appliquer_regles,
    construire_profil,
)
from PIL import Image

REGLES_DEFAUT = ReglesProfilage()


def _png_rvb_carre() -> bytes:
    """Image PNG 300x300 en RVB (profil typique des cliches TB)."""
    buffer = io.BytesIO()
    Image.new("RGB", (300, 300), (120, 120, 120)).save(buffer, format="PNG")
    return buffer.getvalue()


def _png_niveaux_gris_carre() -> bytes:
    """Image PNG 400x400 en niveaux de gris (cas Tuberculosis-109).

    Le cas de reference du projet : une image TB au mode L — la regle doit
    se baser sur format + ratio, jamais sur le niveau de gris seul.
    """
    buffer = io.BytesIO()
    Image.new("L", (400, 400), 128).save(buffer, format="PNG")
    return buffer.getvalue()


def _jpeg_niveaux_gris_rect() -> bytes:
    """Image JPEG 400x220 en niveaux de gris (profil typique des cliches PN)."""
    buffer = io.BytesIO()
    Image.new("L", (400, 220), 128).save(buffer, format="JPEG")
    return buffer.getvalue()


def _jpeg_carre() -> bytes:
    """Image JPEG 300x300, ratio carre -> profil ambigu."""
    buffer = io.BytesIO()
    Image.new("RGB", (300, 300), (120, 120, 120)).save(buffer, format="JPEG")
    return buffer.getvalue()


# ─── construire_profil ───


def test_profil_png_carre_rvb():
    profil = construire_profil(_png_rvb_carre(), nom_fichier="cliche.png")

    assert profil.indecodable is False
    assert profil.format == "PNG"
    assert profil.largeur_px == 300
    assert profil.hauteur_px == 300
    assert profil.ratio_largeur_hauteur is not None
    assert 0.9 <= profil.ratio_largeur_hauteur <= 1.1
    assert profil.mode_canaux == "RGB"
    assert profil.taille_octets > 0
    assert profil.nom_fichier == "cliche.png"


def test_profil_png_niveaux_gris():
    """Le mode L est capture mais ne devra jamais router a lui seul."""
    profil = construire_profil(_png_niveaux_gris_carre())

    assert profil.format == "PNG"
    assert profil.mode_canaux == "L"
    assert profil.indecodable is False


def test_profil_jpeg_niveaux_gris_rect():
    profil = construire_profil(_jpeg_niveaux_gris_rect())

    assert profil.format == "JPEG"
    assert profil.mode_canaux == "L"
    assert profil.ratio_largeur_hauteur is not None
    assert profil.ratio_largeur_hauteur >= 1.1
    assert profil.indecodable is False


def test_profil_contenu_non_image():
    profil = construire_profil(b"ceci n'est pas une image")

    assert profil.indecodable is True
    assert profil.format is None
    assert profil.ratio_largeur_hauteur is None
    assert profil.taille_octets == len(b"ceci n'est pas une image")


def test_profil_contenu_vide():
    profil = construire_profil(b"")

    assert profil.indecodable is True
    assert profil.taille_octets == 0


# ─── appliquer_regles : regles par defaut ───


def test_png_carre_rvb_route_tb():
    profil = construire_profil(_png_rvb_carre())
    filtrage = appliquer_regles(profil, contexte=None, regles=REGLES_DEFAUT)

    assert filtrage.specialistes_admissibles == ["tuberculose"]
    assert filtrage.specialiste_ecarte == "pneumonie"
    assert filtrage.cle_regle == "profil_tb"


def test_png_niveaux_gris_route_tb():
    """Cas Tuberculosis-109 : une image TB en niveaux de gris reste TB."""
    profil = construire_profil(_png_niveaux_gris_carre())
    filtrage = appliquer_regles(profil, contexte=None, regles=REGLES_DEFAUT)

    assert filtrage.specialistes_admissibles == ["tuberculose"]
    assert filtrage.cle_regle == "profil_tb"


def test_jpeg_rect_route_pn():
    profil = construire_profil(_jpeg_niveaux_gris_rect())
    filtrage = appliquer_regles(profil, contexte=None, regles=REGLES_DEFAUT)

    assert filtrage.specialistes_admissibles == ["pneumonie"]
    assert filtrage.specialiste_ecarte == "tuberculose"
    assert filtrage.cle_regle == "profil_pn"


def test_png_carre_contexte_pneumonie_surclasse():
    """Le contexte clinique prime meme sur un profil TB net."""
    profil = construire_profil(_png_rvb_carre())
    filtrage = appliquer_regles(profil, contexte="pneumonie", regles=REGLES_DEFAUT)

    assert filtrage.specialistes_admissibles == ["pneumonie"]
    assert filtrage.specialiste_ecarte == "tuberculose"
    assert filtrage.cle_regle == "contexte_pneumonie"


def test_jpeg_rect_contexte_tuberculose_surclasse():
    profil = construire_profil(_jpeg_niveaux_gris_rect())
    filtrage = appliquer_regles(profil, contexte="tuberculose", regles=REGLES_DEFAUT)

    assert filtrage.specialistes_admissibles == ["tuberculose"]
    assert filtrage.specialiste_ecarte == "pneumonie"
    assert filtrage.cle_regle == "contexte_tuberculose"


def test_contexte_general_lance_les_deux():
    profil = construire_profil(_png_rvb_carre())
    filtrage = appliquer_regles(profil, contexte="general", regles=REGLES_DEFAUT)

    assert filtrage.specialistes_admissibles == ["tuberculose", "pneumonie"]
    assert filtrage.specialiste_ecarte is None
    assert filtrage.cle_regle == "contexte_general"


def test_contexte_none_jpeg_rect_route_pn():
    profil = construire_profil(_jpeg_niveaux_gris_rect())
    filtrage = appliquer_regles(profil, contexte=None, regles=REGLES_DEFAUT)

    assert filtrage.specialistes_admissibles == ["pneumonie"]
    assert filtrage.cle_regle == "profil_pn"


def test_profil_ambigue_lance_les_deux():
    """Un JPEG carre ne correspond a aucune regle -> repli securitaire."""
    profil = construire_profil(_jpeg_carre())
    filtrage = appliquer_regles(profil, contexte=None, regles=REGLES_DEFAUT)

    assert filtrage.specialistes_admissibles == ["tuberculose", "pneumonie"]
    assert filtrage.specialiste_ecarte is None
    assert filtrage.cle_regle == "profil_ambigue"


def test_indecodable_lance_les_deux():
    profil = construire_profil(b"contenu illisible")
    filtrage = appliquer_regles(profil, contexte=None, regles=REGLES_DEFAUT)

    assert filtrage.specialistes_admissibles == ["tuberculose", "pneumonie"]
    assert filtrage.cle_regle == "profil_indecodable"


def test_kill_switch_lance_les_deux():
    """profilage_active=False -> comportement historique, meme sur un profil TB."""
    profil = construire_profil(_png_rvb_carre())
    filtrage = appliquer_regles(
        profil, contexte=None, regles=ReglesProfilage(profilage_active=False)
    )

    assert filtrage.specialistes_admissibles == ["tuberculose", "pneumonie"]
    assert filtrage.cle_regle == "profilage_desactive"
