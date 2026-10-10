"""Outillage de calibration des confiances des modeles AERIS.

Les quatre modeles exposes n'emploient pas la meme convention de sortie, et deux
d'entre eux ont des conventions *opposees* sur une sortie de meme forme. Toute
mesure de calibration doit donc d'abord etre ramenee a une probabilite de la
classe positive, sous peine de calibrer l'inverse de la pathologie.

La table ``ORIENTATIONS`` est l'unique endroit du depot ou ce mappings est
ecrit. Elle doit rester alignee avec ``interpreter_prediction()`` dans
``services/service-tuberculose/app/coeur/inference.py`` et
``services/service-pneumonie/app/coeur/inference.py``, qui decrivent les
modeles **deployes** (Edge v3 depuis le 09/10/2026, Cloud v1) :

- ``pn_edge`` sortait ``P(NORMAL)`` en v1 (``sigmoid_positif=False``) ; le
  modele Edge v3 sort ``P(PNEUMONIE)`` (``sigmoid_positif=True``), comme le
  Cloud. Les scores v1 deja collectes ne dependent pas de ce changement :
  ``collecteur_scores.py`` deduit ``P(pathologie)`` de ``prediction`` et
  ``confiance``, jamais d'une orientation declaree.

Methodes disponibles :

- ``ajuster_temperature`` : correction par un scalaire ``T`` applique au logit.
  Un seul parametre, donc robuste sur de petits echantillons, mais ne corrige
  qu'un exces ou un defaut de confiance symetrique.
- ``ajuster_platt`` : ajustement de ``logit(p) = a + b * logit(p_hat)``.
  Deux parametres, qui *diagnostiquent* avant de corriger : ``b < 1`` signale un
  exces de confiance, ``b = 1`` avec ``a != 0`` signale un biais de base que la
  temperature ne corrigerait pas. Reference : Guo et al., 2017.
- Repli isotonique non fourni volontairement : il sureajuste sur moins de
  quelques centaines d'echantillons et produirait une courbe de fiabilite qui
  decrit l'echantillon de calibration plutot que la loi du modele.

Le choix se fait sur le diagnostic, jamais par defaut : la temperature est
justifiee si et seulement si la pente ``b`` s'ecarte significativement de 1.

Une consequence non evidente du temperature scaling : la transformation
``p -> sigmoid(logit(p) / T)`` est *monotone croissante*, donc **aucune
classification n'est changee**. Recall, specificite, precision et courbe ROC
d'un modele sont rigoureusement identiques avant et apres recalibrage ; seul le
seuil sur l'echelle de probabilite se deplace. Le recalibrage ne rend donc pas
un modele meilleur, il rend ses nombres honnetes : un seuil regle sur une
confiance trompeuse devient enfin exprimable, et c'est la que se trouve le
benefice clinique. Toute comparaison de seuils avant/apres, ou toute promesse
d'amelioration de l'AUC par cette methode, est un contresens.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

import numpy as np

TypeSortie = Literal["sigmoid", "softmax2"]
EPSILON = 1e-12
BINS_PAR_DEFAUT = 10


@dataclass(frozen=True)
class Orientation:
    """Description de la forme de sortie brute d'un modele.

    Attributs :
        type_sortie : ``sigmoid`` pour une sortie scalaire, ``softmax2`` pour
            deux scores de somme 1.
        indice_positif : index de la classe positive dans une sortie softmax2.
        sigmoid_positif : pour une sortie sigmoid, indique si la sortie brute
            est deja ``P(positif)`` (``True``) ou bien ``P(complement)``
            (``False``).
    """

    type_sortie: TypeSortie
    indice_positif: int | None = None
    sigmoid_positif: bool = True


ORIENTATIONS: dict[str, Orientation] = {
    "tb_edge": Orientation(type_sortie="softmax2", indice_positif=1),
    "tb_cloud": Orientation(type_sortie="sigmoid", sigmoid_positif=True),
    "pn_edge": Orientation(type_sortie="sigmoid", sigmoid_positif=True),
    "pn_cloud": Orientation(type_sortie="sigmoid", sigmoid_positif=True),
}


def probabilite_positive_brute(
    sortie_brute: Sequence[float], orientation: Orientation
) -> np.ndarray:
    """Ramene une sortie de modele a la probabilite de la classe positive.

    Parametres :
        sortie_brute : pour ``sigmoid``, un scalaire par image ; pour
            ``softmax2``, deux scores par image.
        orientation : convention declaree pour le modele concerne.

    Retours :
        Vecteur ``P(classe positive)``, de meme longueur que l'entree.
    """
    valeurs = np.asarray(sortie_brute, dtype=np.float64)

    if orientation.type_sortie == "softmax2":
        if valeurs.ndim != 2 or valeurs.shape[1] != 2:
            raise ValueError(f"softmax2 attend une matrice (n, 2), recu {valeurs.shape}")
        indice = orientation.indice_positif
        if indice is None:
            raise ValueError("softmax2 exige indice_positif")
        return np.clip(valeurs[:, indice], EPSILON, 1.0 - EPSILON)

    if valeurs.ndim == 2 and valeurs.shape[1] == 1:
        valeurs = valeurs[:, 0]
    valeurs = np.clip(valeurs, EPSILON, 1.0 - EPSILON)
    return valeurs if orientation.sigmoid_positif else 1.0 - valeurs


def logit(probabilites: np.ndarray) -> np.ndarray:
    """Logit d'un vecteur de probabilites, borne pour eviter l'infini."""
    p = np.clip(np.asarray(probabilites, dtype=np.float64), EPSILON, 1.0 - EPSILON)
    return np.log(p / (1.0 - p))


def sigmoide(logits: np.ndarray) -> np.ndarray:
    """Fonction logistique, stable pour les logits de grande amplitude."""
    z = np.asarray(logits, dtype=np.float64)
    return np.exp(-np.logaddexp(0.0, -z))


def entropie_croisee(logits: np.ndarray, etiquettes: np.ndarray) -> float:
    """Negative log-likelihood moyenne, la metrique optimisee par le calibrage.

    Ecrite avec ``logaddexp`` plutot qu'avec ``log(sigmoid(z))`` : sur un
    modele tres confiant, ``sigmoid`` sature a 0 ou 1, le logarithme donne
    ``-inf`` et l'optimisation recoit un ``nan`` au lieu d'un gradient.
    """
    z = np.asarray(logits, dtype=np.float64)
    y = np.asarray(etiquettes, dtype=np.float64)
    return float(np.mean(y * np.logaddexp(0.0, -z) + (1.0 - y) * np.logaddexp(0.0, z)))


def ajuster_temperature(logits: np.ndarray, etiquettes: np.ndarray) -> float:
    """Estime la temperature optimale par section d'or sur ``1 / T``.

    La NLL est convexe en ``u = 1 / T``, ce qui rend la recherche univoque
    fiable. Le resultat est un scalaire : c'est tout l'interet de la methode,
    elle reste lisible et stockable en base de configuration.

    Parametres :
        logits : logit de ``P(positif)`` pour chaque echantillon.
        etiquettes : 1 pour la classe positive, 0 sinon.

    Retours :
        Temperature ``T >= 1``. Exactement 1.0 si les logits sont deja calibres.
    """
    z = np.asarray(logits, dtype=np.float64)
    y = np.asarray(etiquettes, dtype=np.float64)
    if z.size == 0 or z.shape != y.shape:
        raise ValueError("logits et etiquettes doivent etre deux vecteurs de meme taille")
    if len(np.unique(y)) < 2:
        raise ValueError("le calibrage exige au moins les deux classes presentes")

    bas, haut = 1e-2, 1e2
    phi = (np.sqrt(5.0) - 1.0) / 2.0
    c = haut - phi * (haut - bas)
    d = bas + phi * (haut - bas)
    fc = entropie_croisee(z * c, y)
    fd = entropie_croisee(z * d, y)
    if not (np.isfinite(fc) and np.isfinite(fd)):
        raise ValueError(
            "logits non finis : la borne EPSILON est trop petite pour etre "
            "representable, donc la temperature n est pas estimable"
        )
    for _ in range(100):
        if fc < fd:
            haut, d, fd = d, c, fc
            c = haut - phi * (haut - bas)
            fc = entropie_croisee(z * c, y)
        else:
            bas, c, fc = c, d, fd
            d = bas + phi * (haut - bas)
            fd = entropie_croisee(z * d, y)
        if not (np.isfinite(fc) and np.isfinite(fd)):
            raise ValueError("la recherche de temperature a quitte le domaine fini")
        if haut - bas < 1e-8:
            break
    if bas <= 1e-2 * (1.0 + 1e-6) or haut >= 1e2 * (1.0 - 1e-6):
        raise ValueError(
            "l optimum de la temperature est a la frontiere de la recherche "
            "[1e-2, 1e2] : il n est pas estime, la temperature n est pas "
            "definie par ces donnees"
        )
    return float(1.0 / ((bas + haut) / 2.0))


def ajuster_platt(logits: np.ndarray, etiquettes: np.ndarray) -> tuple[float, float]:
    """Ajuste ``logit(p) = a + b * logit(p_hat)`` par Newton-Raphson.

    Parametres :
        logits : logit de ``P(positif)`` pour chaque echantillon.
        etiquettes : 1 pour la classe positive, 0 sinon.

    Retours :
        Couple ``(ordonnee, pente)``, dans cet ordre. ``pente = 1`` et
        ``ordonnee = 0`` signifient deja calibre.
    """
    z = np.asarray(logits, dtype=np.float64)
    y = np.asarray(etiquettes, dtype=np.float64)
    if z.shape != y.shape:
        raise ValueError("logits et etiquettes doivent etre deux vecteurs de meme taille")
    if len(np.unique(y)) < 2:
        raise ValueError("le calibrage exige au moins les deux classes presentes")

    design = np.column_stack([np.ones_like(z), z])
    beta = np.zeros(2, dtype=np.float64)
    for _ in range(100):
        p = sigmoide(design @ beta)
        poids = np.clip(p * (1.0 - p), 1e-9, None)
        gradient = design.T @ (p - y)
        hessien = (design * poids[:, None]).T @ design + 1e-8 * np.eye(2)
        pas = np.linalg.solve(hessien, gradient)
        beta = beta - pas
        if np.max(np.abs(pas)) < 1e-10:
            break
    return float(beta[0]), float(beta[1])


def courbe_fiabilite(
    probabilites: np.ndarray, etiquettes: np.ndarray, n_bins: int = BINS_PAR_DEFAUT
) -> list[dict[str, float]]:
    """Construit la courbe de fiabilite par tranches de largeur egale.

    Une tranche vide est omise plutot que reportee a zero : afficher un
    compartiment vide comme « exactement calibre » serait une invention.
    """
    p = np.asarray(probabilites, dtype=np.float64)
    y = np.asarray(etiquettes, dtype=np.float64)
    tranches = []
    for indice in range(n_bins):
        bas = indice / n_bins
        haut = (indice + 1) / n_bins
        if indice == n_bins - 1:
            masque = (p >= bas) & (p <= haut)
        else:
            masque = (p >= bas) & (p < haut)
        if not np.any(masque):
            continue
        tranches.append(
            {
                "bin_bas": float(bas),
                "bin_haut": float(haut),
                "effectif": int(masque.sum()),
                "confiance_moyenne": float(p[masque].mean()),
                "frequence_observee": float(y[masque].mean()),
            }
        )
    return tranches


def metriques_calibration(
    probabilites: np.ndarray,
    etiquettes: np.ndarray,
    n_bins: int = BINS_PAR_DEFAUT,
) -> dict[str, float]:
    """Calcule les metriques de calibration d'un vecteur de probabilites.

    Brier et NLL sont des *proper scoring rules* : ils sont primarys. L'ECE est
    une moyenne de differences sur des tranches, donc elle depend de `n_bins` et
    n'est pas convexe ; elle est fournie comme complement et son nombre de
    tranches est toujours reporte avec elle.
    """
    p = np.asarray(probabilites, dtype=np.float64)
    y = np.asarray(etiquettes, dtype=np.float64)
    if p.shape != y.shape:
        raise ValueError("probabilites et etiquettes doivent avoir la meme taille")

    ecart = 0.0
    for tranche in courbe_fiabilite(p, y, n_bins):
        largeur = tranche["bin_haut"] - tranche["bin_bas"]
        ecart += (
            tranche["effectif"]
            / p.size
            * largeur
            * abs(tranche["confiance_moyenne"] - tranche["frequence_observee"])
        )

    base = float(y.mean())
    brier = float(np.mean((p - y) ** 2))
    return {
        "effectif": int(p.size),
        "positifs": int(y.sum()),
        "prevalence": base,
        "brier": brier,
        "brier_skill": 1.0 - brier / (base * (1.0 - base)) if 0.0 < base < 1.0 else float("nan"),
        "nll": entropie_croisee(logit(p), y),
        "ece": float(ecart),
        "nb_tranches": float(n_bins),
        "confiance_moyenne": float(p.mean()),
    }


def estimer_ou_nan(logits: np.ndarray, etiquettes: np.ndarray) -> float:
    """Temperature estimee, ou ``nan`` si elle ne l'est pas.

    Une temperature non estimable (logits non finis, optimum a la frontiere
    de la recherche) n'est pas un zero ni une valeur par defaut : la rapporter
    ferait croire a une mesure la ou il n'y a rien.
    """
    try:
        return ajuster_temperature(logits, etiquettes)
    except ValueError:
        return float("nan")


def intervalle_bootstrap_temperature(
    logits: np.ndarray,
    etiquettes: np.ndarray,
    n_tirages: int = 1000,
    graine: int = 101,
    niveau: float = 0.95,
) -> dict[str, float]:
    """Estime l'incertitude sur la temperature par bootstrap sur les echantillons.

    Un intervalle plus large que l'ecart a 1.0 signifie que la donnee ne
    permet pas de conclure a un exces de confiance : le caller doit alors
    declarer le modele « non calibrable » plutot que « calibree approximativement ».
    """
    z = np.asarray(logits, dtype=np.float64)
    y = np.asarray(etiquettes, dtype=np.float64)
    generateur = np.random.default_rng(graine)
    tirages = np.empty(n_tirages, dtype=np.float64)

    for k in range(n_tirages):
        indices = generateur.integers(0, z.size, z.size)
        if len(np.unique(y[indices])) < 2:
            tirages[k] = np.nan
            continue
        try:
            tirages[k] = ajuster_temperature(z[indices], y[indices])
        except ValueError:
            tirages[k] = np.nan

    valides = tirages[np.isfinite(tirages)]
    if valides.size < 10:
        return {
            "temperature": float("nan"),
            "acquisition_inferieure": float("nan"),
            "acquisition_superieure": float("nan"),
            "tirages_reussis": float(valides.size),
            "exclut_1": float("nan"),
        }

    alpha = (1.0 - niveau) / 2.0
    bas, haut = np.percentile(valides, [100 * alpha, 100 * (1 - alpha)])
    return {
        "temperature": estimer_ou_nan(z, y),
        "acquisition_inferieure": float(bas),
        "acquisition_superieure": float(haut),
        "tirages_reussis": float(valides.size),
        "exclut_1": float(bas > 1.0 or haut < 1.0),
    }


def seuil_pour_rappel(
    probabilites: np.ndarray, etiquettes: np.ndarray, rappel_cible: float
) -> dict[str, float]:
    """Choisit le seuil operatoire atteignant un rappel donne.

     Le seuil n'est pas 0.5 par defaut : il est *derive* d'une exigence
     clinique. Rappel minimal signifie qu'une pathologie non detectee est
    otoxique ; la precision resultante est un cout, pas un defaut.

     Parametres :
         probabilites : probabilite de la classe positive.
         etiquettes : 1 pour la classe positive, 0 sinon.
         rappel_cible : proportion de positifs a convertir en positifs, dans (0, 1].

     Retours :
         Seuil, rappel, precision et effectifs associes. Si le rappel cible est
         inatteignable, le seuil ``0.0`` est renvoye avec le rappel obtenu, ce qui
         rend l'echec explicite plutot que masque.
    """
    p = np.asarray(probabilites, dtype=np.float64)
    y = np.asarray(etiquettes, dtype=np.float64)
    if not 0.0 < rappel_cible <= 1.0:
        raise ValueError("rappel_cible doit appartenir a ]0, 1]")

    if y.sum() == 0:
        raise ValueError("aucun positif dans l'echantillon")

    ordre = np.argsort(-p)
    p_ordonne, y_ordonne = p[ordre], y[ordre]
    cumul_positifs = np.cumsum(y_ordonne)
    total_positifs = float(y.sum())

    atteint = np.flatnonzero(cumul_positifs >= rappel_cible * total_positifs)
    if atteint.size == 0:
        return {
            "seuil": 0.0,
            "rappel": 1.0,
            "precision": float("nan"),
            "specificite": float("nan"),
            "rappel_atteignable": 0.0,
        }

    index = int(atteint[0])
    seuil = float(p_ordonne[index])
    positifs = p >= seuil
    vrais_positifs = float((positifs & (y == 1)).sum())
    faux_positifs = float((positifs & (y == 0)).sum())
    vrais_negatifs = float((~positifs & (y == 0)).sum())

    return {
        "seuil": seuil,
        "rappel": float(vrais_positifs / total_positifs),
        "precision": (
            float(vrais_positifs / (vrais_positifs + faux_positifs))
            if (vrais_positifs + faux_positifs) > 0
            else float("nan")
        ),
        "specificite": (
            float(vrais_negatifs / (vrais_negatifs + faux_positifs))
            if (vrais_negatifs + faux_positifs) > 0
            else float("nan")
        ),
        "rappel_atteignable": 1.0,
    }


def evaluer(
    logits: np.ndarray,
    etiquettes: np.ndarray,
    rappel_cible: float,
    n_bins: int = BINS_PAR_DEFAUT,
    n_tirages_bootstrap: int = 1000,
) -> dict:
    """Diagnostic complet puis correction d'un modele, en un appel.

    Le diagnostic precede la correction et decide de la methode :

    - pente ``b`` compatible avec 1 et ``a`` compatible avec 0 : deja calibre,
      aucune correction appliquee ;
    - ``b`` inferieur a 1 : exces de confiance, temperature scaling ;
    - ``b`` proche de 1 avec ``a`` non nul : biais de base, temperature seule
      ne suffirait pas et le caller est invite a le signaler.

    La classification « compatible » utilise un intervalle bootstrap sur la
    temperature, pas une comparaison a un epsilon arbitraire.
    """
    z = np.asarray(logits, dtype=np.float64)
    y = np.asarray(etiquettes, dtype=np.float64)

    avant = metriques_calibration(sigmoide(z), y, n_bins)
    ordonnee, pente = ajuster_platt(z, y)
    temperature = estimer_ou_nan(z, y)
    acquisition = intervalle_bootstrap_temperature(z, y, n_tirages=n_tirages_bootstrap)

    if np.isfinite(temperature):
        z_calibre = z / temperature
    else:
        z_calibre = z
    apres = metriques_calibration(sigmoide(z_calibre), y, n_bins)
    avant["courbe"] = courbe_fiabilite(sigmoide(z), y, n_bins)
    apres["courbe"] = courbe_fiabilite(sigmoide(z_calibre), y, n_bins)

    if not np.isfinite(temperature):
        diagnostic = "temperature_non_estimable"
        correction = "aucune"
    elif not acquisition["exclut_1"] == 1.0:
        diagnostic = "non_calibrable"
        correction = "aucune"
    elif abs(pente - 1.0) < 0.05 and abs(ordonnee) < 0.05:
        diagnostic = "deja_calibre"
        correction = "aucune"
    elif abs(ordonnee) >= 0.05 and abs(pente - 1.0) < 0.05:
        diagnostic = "biais_de_base"
        correction = "temperature_insuffisante"
    else:
        diagnostic = "exces_de_confiance"
        correction = "temperature_scaling"

    return {
        "temperature": temperature if np.isfinite(temperature) else None,
        "diagnostic": diagnostic,
        "correction_retenue": correction,
        "temperature_estimable": bool(np.isfinite(temperature)),
        "pente_calibration": pente,
        "ordonnee_calibration": ordonnee,
        "acquisition_temperature": acquisition,
        "avant": avant,
        "apres": apres,
        "seuil_brut": seuil_pour_rappel(sigmoide(z), y, rappel_cible),
        "seuil_calibre": seuil_pour_rappel(sigmoide(z_calibre), y, rappel_cible),
    }
