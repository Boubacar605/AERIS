"""Selecteur de destination Edge vs Cloud.

Ce module contient la logique centrale de decision :
il combine les metriques reseau et ressources pour determiner
ou executer l'inference.

Regles de decision :
- Si le reseau est INDISPONIBLE → Edge (mode degrade, urgence)
- Si la latence reseau > seuil → Edge (reseau trop lent)
- Si le CPU Edge > seuil OU la RAM Edge > seuil → Cloud (Edge sature)
- Sinon → Edge (par defaut, proximite des donnees)

TODO: Implementer l'appel HTTP reel aux services d'inference
      selon la destination choisie.
"""

import time

from app.config import config
from app.logique_routage.evaluateur_reseau import (
    mesurer_latence_cloud,
    verifier_connectivite_cloud,
)
from app.logique_routage.evaluateur_ressources import (
    obtenir_utilisation_cpu,
    obtenir_utilisation_ram,
)
from app.schemas.schemas_routage import (
    DecisionRoutage,
    MetriquesSysteme,
    ReponseRoutage,
    ResultatDiagnostic,
)


async def decider_destination(contenu_image: bytes) -> ReponseRoutage:
    """Decide ou envoyer l'image et execute l'inference.

    TODO: Remplacer les stubs de resultats par de vrais appels HTTP
          vers les services tuberculose et pneumonie.
    """
    debut = time.time()

    # Collecte des metriques
    cpu = await obtenir_utilisation_cpu()
    ram = await obtenir_utilisation_ram()
    reseau_ok = await verifier_connectivite_cloud()
    latence = await mesurer_latence_cloud() if reseau_ok else 9999.0

    metriques = MetriquesSysteme(
        cpu_pourcentage=cpu,
        ram_pourcentage=ram,
        latence_reseau_ms=latence,
        reseau_disponible=reseau_ok,
    )

    # Logique de decision
    destination, raison = _appliquer_regles(metriques)

    decision = DecisionRoutage(
        destination=destination,
        raison=raison,
        metriques=metriques,
    )

    # TODO: appeler les vrais services via HTTP selon la destination
    resultats = [
        ResultatDiagnostic(pathologie="tuberculose", prediction="negatif", confiance=0.92),
        ResultatDiagnostic(pathologie="pneumonie", prediction="negatif", confiance=0.87),
    ]

    temps_total = (time.time() - debut) * 1000

    return ReponseRoutage(
        decision=decision,
        resultats=resultats,
        temps_total_ms=round(temps_total, 2),
    )


def _appliquer_regles(metriques: MetriquesSysteme) -> tuple[str, str]:
    """Applique les regles de decision basees sur les seuils configures."""
    if not metriques.reseau_disponible:
        return "edge", "Reseau indisponible — traitement local d'urgence"

    if metriques.latence_reseau_ms > config.seuil_latence_ms:
        return "edge", f"Latence reseau ({metriques.latence_reseau_ms}ms) superieure au seuil ({config.seuil_latence_ms}ms)"

    if metriques.cpu_pourcentage > config.seuil_cpu:
        return "cloud", f"CPU Edge sature ({metriques.cpu_pourcentage}%) — delegation au Cloud"

    if metriques.ram_pourcentage > config.seuil_ram:
        return "cloud", f"RAM Edge saturee ({metriques.ram_pourcentage}%) — delegation au Cloud"

    return "edge", "Conditions normales — traitement local privilegie"
