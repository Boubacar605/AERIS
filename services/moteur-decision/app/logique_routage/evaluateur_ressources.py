"""Evaluation des ressources materielles de l'Edge (CPU, RAM).

Collecte les metriques de charge du noeud Edge via psutil
pour alimenter la decision de routage.
"""

import psutil


async def obtenir_utilisation_cpu() -> float:
    """Obtient le pourcentage d'utilisation CPU du noeud Edge."""
    return psutil.cpu_percent(interval=0.1)


async def obtenir_utilisation_ram() -> float:
    """Obtient le pourcentage d'utilisation RAM du noeud Edge."""
    return psutil.virtual_memory().percent
