"""Evaluation de l'etat du reseau (latence, disponibilite).

Ce module mesure la connectivite vers les services Cloud
pour alimenter la decision de routage.

TODO: Implementer la mesure reelle de latence via ping/HTTP HEAD
      vers les services Cloud.
"""

from app.schemas.schemas_routage import MetriquesSysteme


async def mesurer_latence_cloud() -> float:
    """Mesure la latence reseau vers les services Cloud.

    TODO: Implementer avec httpx (HEAD request vers le service Cloud,
          mesure du round-trip time).

    Returns:
        Latence en millisecondes.
    """
    return 50.0


async def verifier_connectivite_cloud() -> bool:
    """Verifie si le reseau vers le Cloud est disponible.

    TODO: Implementer une verification reelle (timeout sur requete HTTP).

    Returns:
        True si le Cloud est joignable, False sinon.
    """
    return True
