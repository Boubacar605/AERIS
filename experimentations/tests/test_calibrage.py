"""Validation des proprietes mathematiques de l'outillage de calibration.

Ces tests ne verifient pas des valeurs figees mais des proprietes : une
temperature doit etre retrouvee quand elle est connue, une calibration doit
ameliorer la NLL ou rester neutre, un seuil doit atteindre le rappel demande.
Un outil de calibration erroneVerifierait des confidences en apparence
raisonnables ; ces tests sont la seule barriere.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

RACINE_PROJET = Path(__file__).resolve().parents[2]
if str(RACINE_PROJET) not in sys.path:
    sys.path.insert(0, str(RACINE_PROJET))

from experimentations.communs.calibrage import (  # noqa: E402
    ORIENTATIONS,
    Orientation,
    ajuster_platt,
    ajuster_temperature,
    courbe_fiabilite,
    entropie_croisee,
    evaluer,
    logit,
    metriques_calibration,
    probabilite_positive_brute,
    seuil_pour_rappel,
    sigmoide,
)

GRAINE = 20260927


def echantillon_etiquette(
    n: int, temperature_connue: float | None = None, graine: int = GRAINE
) -> tuple[np.ndarray, np.ndarray]:
    """Simule un modele dont on controle exactement la calibration.

    Parametres :
        n : nombre d'echantillons.
        temperature_connue : si fournie, le logit emis vaut
            ``temperature_connue * logit(p_reel)``, ce qui sur-confiant le
            modele d'un facteur connu, conformement a la convention standard
            (``T > 1`` sur-confiant). Attention : elever la probabilite a la
            puissance ``T`` ne donnerait *pas* une temperature ``T``, car
            ``logit(x**T) != T * logit(x)``.

    Retours :
        Couple ``(logits, etiquettes)``.
    """
    generateur = np.random.default_rng(graine)
    reels = generateur.uniform(0.02, 0.98, n)
    etiquettes = (generateur.uniform(size=n) < reels).astype(np.float64)
    logits = logit(reels)
    if temperature_connue is not None:
        logits = logits * temperature_connue
    return logits, etiquettes


class TestOrientationSortie:
    def test_sigmoid_positif_est_direct(self):
        brut = np.array([0.9, 0.1, 0.55])
        obtenu = probabilite_positive_brute(brut, ORIENTATIONS["tb_cloud"])
        np.testing.assert_allclose(obtenu, brut)

    def test_pn_edge_est_direct_depuis_v3(self):
        brut = np.array([0.9, 0.1, 0.55])
        obtenu = probabilite_positive_brute(brut, ORIENTATIONS["pn_edge"])
        np.testing.assert_allclose(obtenu, brut)

    def test_sigmoid_inverse_reste_supporte(self):
        brut = np.array([0.9, 0.1, 0.55])
        obtenu = probabilite_positive_brute(
            brut, Orientation(type_sortie="sigmoid", sigmoid_positif=False)
        )
        np.testing.assert_allclose(obtenu, 1.0 - brut)

    def test_softmax_deux_classes_selectionne_la_classe_positive(self):
        brut = np.array([[0.7, 0.3], [0.2, 0.8]])
        obtenu = probabilite_positive_brute(brut, ORIENTATIONS["tb_edge"])
        np.testing.assert_allclose(obtenu, [0.3, 0.8])

    def test_softmax_refuse_une_mauvaise_forme(self):
        with pytest.raises(ValueError, match=r"\(n, 2\)"):
            probabilite_positive_brute(np.array([0.3, 0.7]), ORIENTATIONS["tb_edge"])

    def test_softmax_exige_un_indice(self):
        with pytest.raises(ValueError, match="indice_positif"):
            probabilite_positive_brute(np.array([[0.7, 0.3]]), Orientation(type_sortie="softmax2"))

    def test_sigmoid_accepte_une_colonne_unique(self):
        obtenu = probabilite_positive_brute(np.array([[0.8], [0.2]]), ORIENTATIONS["pn_cloud"])
        np.testing.assert_allclose(obtenu, [0.8, 0.2])

    def test_les_quatre_conventions_coverrent_les_modes_de_deploiement(self):
        assert set(ORIENTATIONS) == {"tb_edge", "tb_cloud", "pn_edge", "pn_cloud"}
        assert ORIENTATIONS["pn_edge"].sigmoid_positif is True
        assert ORIENTATIONS["pn_cloud"].sigmoid_positif is True


class TestTemperature:
    def test_retrouve_une_temperature_connue(self):
        z, y = echantillon_etiquette(4000, temperature_connue=2.0)
        assert ajuster_temperature(z, y) == pytest.approx(2.0, abs=0.1)

    def test_laisse_intacte_un_modele_deja_calibre(self):
        z, y = echantillon_etiquette(4000)
        assert ajuster_temperature(z, y) == pytest.approx(1.0, abs=0.1)

    def test_ameliore_ou_negrade_pas_la_nll(self):
        z, y = echantillon_etiquette(4000, temperature_connue=3.0)
        temperature = ajuster_temperature(z, y)
        assert entropie_croisee(z / temperature, y) <= entropie_croisee(z, y) + 1e-9

    def test_exige_les_deux_classes(self):
        z, _ = echantillon_etiquette(100)
        with pytest.raises(ValueError, match="deux classes"):
            ajuster_temperature(z, np.zeros_like(z))

    def test_refuse_des_tailles_incompatibles(self):
        with pytest.raises(ValueError, match="meme taille"):
            ajuster_temperature(np.zeros(10), np.zeros(9))

    def test_logits_constants_refuses_car_la_temperature_n_est_pas_identifiable(self):
        """Des logits tous egaux ne permettent d'estimer aucune temperature.

        La vraisemblance est alors monotone vers « aucune mise a l'echelle »,
        donc l'optimum est a la frontiere de la recherche. Renvoyer la
        frontiere (T = 100) ferait croire a une mesure : la fonction leve.
        """
        z = np.full(50, 2.0)
        y = np.array([1.0] * 25 + [0.0] * 25)
        with pytest.raises(ValueError, match="frontiere"):
            ajuster_temperature(z, y)


class TestPlatt:
    def test_pente_inferieure_a_un_sur_confiance(self):
        z, y = echantillon_etiquette(4000, temperature_connue=3.0)
        _, pente = ajuster_platt(z, y)
        assert pente < 0.75

    def test_pente_proche_de_un_si_calibre(self):
        z, y = echantillon_etiquette(4000)
        _, pente = ajuster_platt(z, y)
        assert pente == pytest.approx(1.0, abs=0.15)

    def test_evaluer_ne_confond_pas_ordonnee_et_pente(self):
        z, y = echantillon_etiquette(4000, temperature_connue=3.0)
        rapport = evaluer(z, y, rappel_cible=0.90, n_tirages_bootstrap=150)
        ordonnee, pente = ajuster_platt(z, y)
        assert rapport["pente_calibration"] == pytest.approx(pente)
        assert rapport["ordonnee_calibration"] == pytest.approx(ordonnee)

    def test_ordonnee_nulle_sans_biais_introduit(self):
        z, y = echantillon_etiquette(4000)
        ordonnee, _ = ajuster_platt(z, y)
        assert abs(ordonnee) < 0.15


class TestMetriques:
    def test_brier_nul_sur_classification_parfaite(self):
        p = np.array([0.0, 0.0, 1.0, 1.0])
        y = np.array([0.0, 0.0, 1.0, 1.0])
        assert metriques_calibration(p, y)["brier"] == pytest.approx(0.0)

    def test_brier_pire_que_toujours_prevoir_la_prevalence(self):
        y = np.array([0.0] * 20 + [1.0] * 80)
        aveugle = metriques_calibration(np.full(100, 0.8), y)
        assert aveugle["brier"] == pytest.approx(0.8 * 0.2)
        assert aveugle["brier_skill"] == pytest.approx(0.0, abs=1e-9)

    def test_skill_positif_pour_une_bonne_regle(self):
        y = np.array([0.0] * 80 + [1.0] * 20)
        bonne = np.concatenate([np.full(80, 0.05), np.full(20, 0.95)])
        aveugle = metriques_calibration(np.full(100, 0.2), y)
        assert metriques_calibration(bonne, y)["brier"] < aveugle["brier"]
        assert metriques_calibration(bonne, y)["brier_skill"] > 0.9

    def test_ece_nulle_sur_un_modele_parfaitement_calibre(self):
        y = np.array([0.0, 1.0] * 50)
        assert metriques_calibration(y.astype(float), y)["ece"] == pytest.approx(0.0, abs=1e-12)

    def test_ece_refuse_les_tranches_vides_dans_le_detalle(self):
        y = np.array([0.0, 0.0, 1.0, 1.0])
        tranches = courbe_fiabilite(np.array([0.02, 0.03, 0.97, 0.98]), y, n_bins=10)
        assert len(tranches) == 2
        assert sum(t["effectif"] for t in tranches) == 4

    def test_la_derniere_tranche_inclut_la_borne_haute(self):
        tranches = courbe_fiabilite(np.array([1.0]), np.array([1.0]), n_bins=5)
        assert len(tranches) == 1
        assert tranches[0]["effectif"] == 1

    def test_refuse_des_tailles_incompatibles(self):
        with pytest.raises(ValueError, match="meme taille"):
            metriques_calibration(np.zeros(5), np.zeros(4))

    def test_sigmoide_et_logit_sont_inverses(self):
        z = np.array([-5.0, -1.0, 0.0, 2.5, 5.0])
        np.testing.assert_allclose(logit(sigmoide(z)), z, rtol=1e-9, atol=1e-9)

    def test_logit_borne_les_probabilites_extremes(self):
        z = np.array([-60.0, 60.0])
        recouvre = logit(sigmoide(z))
        assert np.all(np.isfinite(recouvre))
        assert recouvre[0] > -30.0
        assert recouvre[1] < 30.0

    def test_sigmoide_reste_fini_sur_extremes(self):
        assert np.all(np.isfinite(sigmoide(np.array([-800.0, 800.0]))))


class TestSeuilOperatoire:
    def test_atteint_le_rappel_cible(self):
        z, y = echantillon_etiquette(3000, temperature_connue=2.0, graine=7)
        p = sigmoide(z)
        for cible in (0.85, 0.90, 0.95, 0.99):
            resultat = seuil_pour_rappel(p, y, cible)
            assert resultat["rappel"] >= cible - 1e-9

    def test_un_rappel_exige_abaissant_le_seuil(self):
        z, y = echantillon_etiquette(3000, graine=11)
        p = sigmoide(z)
        assert seuil_pour_rappel(p, y, 0.95)["seuil"] < seuil_pour_rappel(p, y, 0.80)["seuil"]

    def test_specificite_decroit_avec_le_rappel_exige(self):
        z, y = echantillon_etiquette(3000, graine=13)
        p = sigmoide(z)
        large = seuil_pour_rappel(p, y, 0.80)
        strict = seuil_pour_rappel(p, y, 0.99)
        assert strict["specificite"] < large["specificite"]

    def test_refuse_un_rappel_hors_bornes(self):
        with pytest.raises(ValueError, match=r"\]0, 1\]"):
            seuil_pour_rappel(np.array([0.5, 0.6]), np.array([0.0, 1.0]), 1.5)

    def test_refuse_un_echantillon_sans_positif(self):
        with pytest.raises(ValueError, match="aucun positif"):
            seuil_pour_rappel(np.array([0.1, 0.2]), np.array([0.0, 0.0]), 0.9)

    def test_rappel_deja_satisfait_pour_predispositif_parfait(self):
        resultat = seuil_pour_rappel(np.array([0.9, 0.1]), np.array([1.0, 0.0]), 0.9)
        assert resultat["rappel"] == pytest.approx(1.0)


class TestEvaluationComplete:
    def test_diagnostique_un_exces_de_confiance(self):
        z, y = echantillon_etiquette(4000, temperature_connue=3.0)
        rapport = evaluer(z, y, rappel_cible=0.90, n_tirages_bootstrap=150)
        assert rapport["temperature"] == pytest.approx(3.0, abs=0.2)
        assert rapport["correction_retenue"] == "temperature_scaling"

    def test_la_correction_ameliore_les_metriques(self):
        z, y = echantillon_etiquette(4000, temperature_connue=4.0)
        rapport = evaluer(z, y, rappel_cible=0.90, n_tirages_bootstrap=150)
        assert rapport["apres"]["nll"] < rapport["avant"]["nll"]
        assert rapport["apres"]["brier"] < rapport["avant"]["brier"]
        assert rapport["apres"]["ece"] < rapport["avant"]["ece"]

    def test_le_seuil_fixe_de_050_manque_souvent_le_rappel_cible(self):
        z, y = echantillon_etiquette(4000, temperature_connue=5.0)
        rapport = evaluer(z, y, rappel_cible=0.95, n_tirages_bootstrap=150)
        au_seuil_fixe = float((sigmoide(z) >= 0.5)[y == 1].mean())
        assert au_seuil_fixe < 0.95
        assert rapport["seuil_calibre"]["rappel"] >= 0.95

    def test_la_calibration_preserve_exactement_la_classification(self):
        z, y = echantillon_etiquette(4000, temperature_connue=5.0, graine=17)
        rapport = evaluer(z, y, rappel_cible=0.95, n_tirages_bootstrap=150)
        brut = rapport["seuil_brut"]
        calibre = rapport["seuil_calibre"]
        assert calibre["rappel"] == pytest.approx(brut["rappel"])
        assert calibre["specificite"] == pytest.approx(brut["specificite"])
        assert calibre["precision"] == pytest.approx(brut["precision"])

    def test_les_seuils_avant_et_apres_ne_sont_pas_comparables(self):
        z, y = echantillon_etiquette(4000, temperature_connue=5.0, graine=19)
        rapport = evaluer(z, y, rappel_cible=0.95, n_tirages_bootstrap=150)
        assert rapport["seuil_calibre"]["seuil"] > rapport["seuil_brut"]["seuil"]

    def test_expose_la_courbe_de_fiabilite_avant_et_apres(self):
        z, y = echantillon_etiquette(2000, temperature_connue=2.0)
        rapport = evaluer(z, y, rappel_cible=0.90, n_tirages_bootstrap=150)
        assert sum(t["effectif"] for t in rapport["avant"]["courbe"]) == 2000
        assert sum(t["effectif"] for t in rapport["apres"]["courbe"]) == 2000

    def test_declare_non_calibrable_si_le_bootstrapp_inclut_un(self):
        z, y = echantillon_etiquette(60, graine=3)
        rapport = evaluer(z, y, rappel_cible=0.90, n_tirages_bootstrap=200)
        if rapport["acquisition_temperature"]["exclut_1"] != 1.0:
            assert rapport["diagnostic"] == "non_calibrable"
            assert rapport["correction_retenue"] == "aucune"

    def test_le_bootstrapp_est_deterministe_a_graine_fixe(self):
        z, y = echantillon_etiquette(2000, temperature_connue=2.0)
        premier = evaluer(z, y, rappel_cible=0.90, n_tirages_bootstrap=200)
        second = evaluer(z, y, rappel_cible=0.90, n_tirages_bootstrap=200)
        assert premier["temperature"] == second["temperature"]
        assert (
            premier["acquisition_temperature"]["acquisition_inferieure"]
            == second["acquisition_temperature"]["acquisition_inferieure"]
        )

    def test_un_echantillon_une_seule_classe_est_refuse(self):
        z, _ = echantillon_etiquette(50)
        with pytest.raises(ValueError, match="deux classes"):
            evaluer(z, np.zeros_like(z), rappel_cible=0.90)

    def test_des_logits_non_finis_sont_refuses(self):
        """Un ajustement non estimable doit lever, pas renvoyer la borne.

        Avec une borne EPSILON trop petite, ``logit`` produit ``inf``, la
        NLL vaut ``nan`` et la section d'or se rabattait sur sa borne basse :
        le rapport affichait alors une temperature (T = 0,01) et declarait
        l'intervalle de confiance incapable de contenir 1, alors qu'aucune
        valeur n'avait ete estimee. C'est le pire defaut possible pour un
        outil de calibration : une conclusion assertive et fausse.
        """
        z, y = echantillon_etiquette(60)
        z = np.where(np.arange(len(z)) < 20, np.inf, z)
        with np.errstate(invalid="ignore", divide="ignore"):
            with pytest.raises(ValueError, match="non finis|temps"):
                ajuster_temperature(z, y)
