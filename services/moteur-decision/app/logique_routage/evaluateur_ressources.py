"""Evaluation des ressources materielles de l'Edge (CPU, RAM).

Ce module collecte les metriques de charge du noeud Edge
pour alimenter la decision de routage.

TODO: Implementer la collecte reelle via psutil ou via l'API Prometheus.
"""


async def obtenir_utilisation_cpu() -> float:
    """Obtient le pourcentage d'utilisation CPU du noeud Edge.

    TODO: Implementer avec psutil.cpu_percent() ou requete Prometheus.

    Returns:
        Pourcentage d'utilisation CPU (0-100).
    """
    return 45.0


async def obtenir_utilisation_ram() -> float:
    """Obtient le pourcentage d'utilisation RAM du noeud Edge.

    TODO: Implementer avec psutil.virtual_memory().percent ou requete Prometheus.

    Returns:
        Pourcentage d'utilisation RAM (0-100).
    """
    return 60.0
