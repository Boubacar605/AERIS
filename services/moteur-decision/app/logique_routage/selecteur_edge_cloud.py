"""Selecteur de destination Edge vs Cloud et arbitre de fiabilite.

Logique centrale de decision : combine les metriques reseau et ressources
pour determiner ou executer l'inference, puis appelle les services
de diagnostic en parallele (tuberculose + pneumonie).

Regles de decision (routage primaire) :
- Reseau INDISPONIBLE -> Edge (mode degrade, urgence)
- Latence reseau > seuil -> Edge (reseau trop lent)
- CPU Edge > seuil OU RAM Edge > seuil -> Cloud (Edge sature)
- Sinon -> Edge (par defaut, proximite des donnees)

Filet de securite de confiance (controle qualite post-inference) :
Toute pathologie dont la confiance est sous ``seuil_confiance_escalade``
est re-invoquee sur l'autre source (Edge <-> Cloud) si elle est joignable.
Les deux avis sont arbitres au plus confiant, et chaque controle est trace
sous forme d'``EvenementEscalade``. Un verdict encore ambigu apres escalade
est marque ``indetermine`` (jamais de « n'importe quoi » retourne).
"""

import asyncio
import logging
import time
from typing import Any

import httpx

from app.config import config
from app.logique_routage.evaluateur_reseau import (
    mesurer_latence_cloud,
    verifier_connectivite_cloud,
)
from app.logique_routage.evaluateur_ressources import obtenir_metriques_completes
from app.logique_routage.profil_image import (
    ReglesProfilage,
    appliquer_regles,
    construire_profil,
)
from app.schemas.schemas_routage import (
    DecisionRoutage,
    EvenementEscalade,
    MetriquesSysteme,
    ReponseRoutage,
    ResultatDiagnostic,
)

logger = logging.getLogger(__name__)

TIMEOUT_INFERENCE = 30.0


def _obtenir_urls(destination: str) -> tuple[str, str]:
    """Retourne les URLs des services TB et PN selon la destination."""
    if destination == "edge":
        return config.url_service_tb_edge, config.url_service_pn_edge
    return config.url_service_tb_cloud, config.url_service_pn_cloud


async def _appeler_service(
    client: httpx.AsyncClient,
    url: str,
    contenu_image: bytes,
    nom_service: str,
    source: str,
) -> ResultatDiagnostic:
    """Appelle un service de diagnostic et retourne le resultat.

    ``source`` indique la source attendue ("edge" ou "cloud") ; la valeur
    reelle declaree par le service (``mode_deploiement``) est privilegiee
    si presente.
    """
    try:
        reponse = await client.post(
            f"{url}/diagnostic/analyser",
            files={"fichier": ("radiographie.png", contenu_image, "image/png")},
        )
        reponse.raise_for_status()
        donnees = reponse.json()
        return ResultatDiagnostic(
            pathologie=donnees["pathologie"],
            prediction=donnees["prediction"],
            confiance=donnees["confiance"],
            temps_inference_ms=donnees.get("temps_inference_ms", 0.0),
            source=donnees.get("mode_deploiement", source),
        )
    except (httpx.RequestError, httpx.HTTPStatusError) as e:
        logger.error("Erreur appel %s (%s) : %s", nom_service, url, e)
        return ResultatDiagnostic(
            pathologie=nom_service,
            prediction="erreur",
            confiance=0.0,
            temps_inference_ms=0.0,
            source=source,
        )


def _entraine_escalade(confiance: float, seuil_escalade: float) -> bool:
    """True si le score necessite un controle qualite (confiance < seuil).

    Un score de 0.0 signale aussi une erreur d'appel : declencher l'escalade
    agit alors comme filet de secours (reprise sur l'autre source).
    """
    return confiance < seuil_escalade


def _arbitrer_resultats(
    primaire: ResultatDiagnostic,
    controle: ResultatDiagnostic,
    seuil_indetermine: float,
) -> tuple[ResultatDiagnostic, EvenementEscalade]:
    """Retient le plus confiant des deux sources et trace l'evenement.

    Si la confiance finale reste sous ``seuil_indetermine``, le verdict est
    marque ``indetermine`` (relecture medicale requise).
    """
    if controle.confiance > primaire.confiance:
        retenu = controle
        decision = "arbitrage_a_prevalu"
        raison = (
            f"Second avis {controle.source} plus confiant "
            f"({controle.confiance:.0%} vs {primaire.confiance:.0%})"
        )
    else:
        retenu = primaire
        decision = "arbitrage_conserve_initial"
        raison = (
            f"Resultat initial {primaire.source} conserve "
            f"({primaire.confiance:.0%} vs {controle.confiance:.0%})"
        )

    evenement = EvenementEscalade(
        pathologie=primaire.pathologie,
        source_initiale=primaire.source,
        confiance_initiale=primaire.confiance,
        source_controle=controle.source,
        confiance_controle=controle.confiance,
        decision=decision,
        raison=raison,
    )

    final = retenu.model_copy(
        update={
            "source": retenu.source,
            "escalade": True,
            "confiance_initiale": primaire.confiance,
            "source_initiale": primaire.source,
            "indetermine": retenu.confiance < seuil_indetermine,
        }
    )
    return final, evenement


def _evenement_escalade_impossible(
    primaire: ResultatDiagnostic, source_controle: str, raison: str
) -> EvenementEscalade:
    """Construit l'evenement trace quand le second avis n'a pas abouti."""
    return EvenementEscalade(
        pathologie=primaire.pathologie,
        source_initiale=primaire.source,
        confiance_initiale=primaire.confiance,
        source_controle=source_controle,
        confiance_controle=primaire.confiance,
        decision="escalade_impossible",
        raison=raison,
    )


async def _mier_appels_controle(
    client: httpx.AsyncClient,
    controles_requis: list[ResultatDiagnostic],
    contenu_image: bytes,
    source_controle: str,
) -> dict[str, ResultatDiagnostic]:
    """Lance les appels de controle en parallele et range par pathologie."""
    url_tb, url_pn = _obtenir_urls(source_controle)
    appetits: list[tuple[str, Any]] = []
    for requis in controles_requis:
        url = url_tb if requis.pathologie == "tuberculose" else url_pn
        appetits.append(
            (
                requis.pathologie,
                _appeler_service(client, url, contenu_image, requis.pathologie, source_controle),
            )
        )

    resultats = await asyncio.gather(*(coroutine for _, coroutine in appetits))
    return {pathologie: resultat for (pathologie, _), resultat in zip(appetits, resultats)}


async def decider_destination(
    contenu_image: bytes,
    force_destination: str | None = None,
    contexte: str | None = None,
    nom_fichier: str | None = None,
    second_avis: bool | None = None,
) -> ReponseRoutage:
    """Decide ou envoyer l'image, execute l'inference, puis applique le
    filet de securite de confiance.

    Le profilage d'image determine quels specialistes sont admissibles
    (routage selectif) : une pathologie dont le domaine ne correspond pas
    au profil de l'image ne recoit aucun appel reseau. Un contexte clinique
    optionnel surclasse la regle automatique.

    Si force_destination est "edge" ou "cloud", le routage automatique est
    ignore **et l'inference reste sur cette source** : c'est la promesse de
    l'API (« l'inference est forcee vers la destination choisie »), et c'est
    aussi ce qui rend le scenario « Tout-Edge » mesurable — un envoi vers le
    Cloud faussait completement les confidences (70 % de 1.0 sur l'Edge).

    ``second_avis`` permet de/reactiver explicitement le controle qualite
    croise meme en destination forcee. La prudence clinique est alors
    preservee autrement : un verdict trop ambigu est marque ``indetermine``
    plutot que d'etre remplace par celui de l'autre source.
    """
    debut = time.time()

    if second_avis is None:
        second_avis = force_destination not in ("edge", "cloud")

    metriques_edge, reseau_ok = await asyncio.gather(
        obtenir_metriques_completes(),
        verifier_connectivite_cloud(),
    )

    cpu = metriques_edge.get("cpu_pourcentage", 99.0)
    ram = metriques_edge.get("ram_pourcentage", 99.0)
    latence = await mesurer_latence_cloud() if reseau_ok else 9999.0

    metriques = MetriquesSysteme(
        cpu_pourcentage=cpu,
        ram_pourcentage=ram,
        latence_reseau_ms=latence,
        reseau_disponible=reseau_ok,
    )

    if force_destination in ("edge", "cloud"):
        destination = force_destination
        raison = f"Destination forcee manuellement vers {destination}"
        if not second_avis:
            raison += " (second avis desactive : verdict issu de cette seule source)"
    else:
        destination, raison = _appliquer_regles(metriques)

    decision = DecisionRoutage(
        destination=destination,
        raison=raison,
        metriques=metriques,
        second_avis=second_avis,
    )

    logger.info("Decision : %s - %s", destination, raison)

    # Profilage image : determine les specialistes admissibles (routage selectif).
    profil = construire_profil(contenu_image, nom_fichier)
    regles = ReglesProfilage(
        seuil_ratio_carre_inf=config.seuil_ratio_carre_inf,
        seuil_ratio_carre_sup=config.seuil_ratio_carre_sup,
        seuil_ratio_pn=config.seuil_ratio_pn,
        format_image_tb=config.format_image_tb,
        format_image_pn=config.format_image_pn,
        profilage_active=config.profilage_active,
    )
    filtrage = appliquer_regles(profil, contexte, regles)
    admissibles = filtrage.specialistes_admissibles

    # Une cible de specialiste unique enrichit la raison de la decision.
    if len(admissibles) == 1:
        decision.raison = f"{decision.raison} — Ciblage {admissibles[0]}, specialiste unique."

    url_tb, url_pn = _obtenir_urls(destination)
    urls = {"tuberculose": url_tb, "pneumonie": url_pn}

    async with httpx.AsyncClient(timeout=TIMEOUT_INFERENCE) as client:
        # 1. Inference primaire en parallele sur les specialistes admissibles.
        #    La pathologie ecartee par le profilage ne recoit aucun appel reseau.
        appetits = [
            (
                pathologie,
                _appeler_service(client, urls[pathologie], contenu_image, pathologie, destination),
            )
            for pathologie in admissibles
        ]
        primaires = list(await asyncio.gather(*(coroutine for _, coroutine in appetits)))

        # 2. Controle qualite par pathologie (filet de securite).
        escalades: list[EvenementEscalade] = []
        temps_escalade_ms = 0.0
        source_controle = "cloud" if destination == "edge" else "edge"

        if not second_avis:
            # Destination forcee sans second avis : aucune requete vers
            # l'autre source. La prudence est assuree en marquant les
            # verdicts trop ambigus, plutot qu'en les remplacant.
            for r in primaires:
                if _entraine_escalade(r.confiance, config.seuil_confiance_escalade):
                    r.indetermine = r.confiance < config.seuil_confiance_indetermine
            logger.info(
                "Second avis desactive (destination forcee) — %d verdict(s) marque(s) "
                "indetermine(s) sur %d",
                sum(1 for r in primaires if r.indetermine),
                len(primaires),
            )

        controles_requis = (
            []
            if not second_avis
            else [
                r
                for r in primaires
                if _entraine_escalade(r.confiance, config.seuil_confiance_escalade)
            ]
        )

        if controles_requis:
            if source_controle == "cloud" and not reseau_ok:
                # Mode degrade : second avis Cloud impossible, on le trace.
                for r in controles_requis:
                    escalades.append(
                        _evenement_escalade_impossible(
                            r,
                            source_controle,
                            "Reseau indisponible - second avis Cloud impossible",
                        )
                    )
                    r.indetermine = r.confiance < config.seuil_confiance_indetermine
            else:
                debut_escalade = time.time()
                controles = await _mier_appels_controle(
                    client, controles_requis, contenu_image, source_controle
                )
                temps_escalade_ms = (time.time() - debut_escalade) * 1000

                for i, primaire in enumerate(primaires):
                    if not _entraine_escalade(primaire.confiance, config.seuil_confiance_escalade):
                        continue
                    controle = controles.get(primaire.pathologie)
                    if controle is None or controle.prediction == "erreur":
                        escalades.append(
                            _evenement_escalade_impossible(
                                primaire,
                                source_controle,
                                "Second avis injoignable ou en erreur - resultat primaire conserve",
                            )
                        )
                        primaire.indetermine = (
                            primaire.confiance < config.seuil_confiance_indetermine
                        )
                        continue
                    final, evenement = _arbitrer_resultats(
                        primaire, controle, config.seuil_confiance_indetermine
                    )
                    escalades.append(evenement)
                    primaires[i] = final

    temps_total = (time.time() - debut) * 1000

    logger.info(
        "Routage termine [%s] : %d pathologie(s) inferee(s) - %sms - %d escalade(s)",
        destination,
        len(primaires),
        round(temps_total, 2),
        len(escalades),
    )
    for resultat in primaires:
        logger.info(
            "  %s -> %s (%.2f @ %s)",
            resultat.pathologie,
            resultat.prediction,
            resultat.confiance,
            resultat.source,
        )

    return ReponseRoutage(
        decision=decision,
        resultats=primaires,
        escalades=escalades,
        temps_total_ms=round(temps_total, 2),
        temps_escalade_ms=round(temps_escalade_ms, 2) if escalades else None,
        filtrage=filtrage,
    )


def _appliquer_regles(metriques: MetriquesSysteme) -> tuple[str, str]:
    """Applique les regles de decision basees sur les seuils configures."""
    if not metriques.reseau_disponible:
        return "edge", "Reseau indisponible - traitement local d'urgence"

    if metriques.latence_reseau_ms > config.seuil_latence_ms:
        return "edge", (
            f"Latence reseau ({metriques.latence_reseau_ms}ms) "
            f"superieure au seuil ({config.seuil_latence_ms}ms)"
        )

    if metriques.cpu_pourcentage > config.seuil_cpu:
        return "cloud", (
            f"CPU Edge sature ({metriques.cpu_pourcentage}%) " f"- delegation au Cloud"
        )

    if metriques.ram_pourcentage > config.seuil_ram:
        return "cloud", (
            f"RAM Edge saturee ({metriques.ram_pourcentage}%) " f"- delegation au Cloud"
        )

    return "edge", "Conditions normales - traitement local privilegie"
