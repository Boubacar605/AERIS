"""Lecture des ressources du conteneur (cgroup) avec repli sur l'hote.

Le moteur de decision compare ces valeurs aux seuils de saturation Edge
(80 % CPU, 85 % RAM). Or ``psutil`` seul lit ``/proc/meminfo`` de la machine
hote : dans un conteneur Docker limite a 512 Mo, ``virtual_memory().total``
renverrait les 8 Go du portable, et la regle de routage RAM serait inoperante.

Ce module lit donc en priorite les compteurs du cgroup (v2, puis v1), ce qui
reflete reellement la contenante simulee par ``docker compose --cpus/--memory``.
Hors conteneur (execution locale, tests), le cgroup est absent : on retombe
volontairement sur ``psutil``, et la source est signalee dans la reponse.
"""

import os
import time

import psutil

_CGROUP_V2 = "/sys/fs/cgroup"
_CGROUP_V1_MEM = "/sys/fs/cgroup/memory"
_CGROUP_V1_CPUACCT = "/sys/fs/cgroup/cpuacct"

# Sentinelle "aucune limite" (cgroup v2 : "max" ; cgroup v1 : valeur enorme).
_SANS_LIMITE = 1 << 62


def _lire(path: str) -> float | None:
    """Lit un fichier cgroup et renvoie un float, ou None si absent/illisible."""
    try:
        with open(path, encoding="utf-8") as f:
            return float(f.read().strip())
    except (OSError, ValueError):
        return None


def ram_pourcentage() -> tuple[float, float, float, str]:
    """(pourcentage, utilisee_mb, totale_mb, source) : cgroup v2/v1 ou psutil.

    La RAM est la seule grandeur ou la limite ``--memory`` change la mesure :
    c'est celle qu'il faut donc lire dans le cgroup pour que la saturation
    simulee par docker-compose soit visible du moteur de decision.
    """
    # ── cgroup v2 : memory.max = plafond, memory.current = conso instantanee ──
    plafond = _lire(f"{_CGROUP_V2}/memory.max")
    if plafond is not None:
        courant = _lire(f"{_CGROUP_V2}/memory.current")
        if courant is not None and 0 < plafond < _SANS_LIMITE:
            return (
                100.0 * courant / plafond,
                round(courant / (1024 * 1024), 1),
                round(plafond / (1024 * 1024), 1),
                "cgroup",
            )

    # ── cgroup v1 ──
    plafond_v1 = _lire(f"{_CGROUP_V1_MEM}/memory.limit_in_bytes")
    if plafond_v1 is not None:
        courant_v1 = _lire(f"{_CGROUP_V1_MEM}/memory.usage_in_bytes")
        if courant_v1 is not None and 0 < plafond_v1 < _SANS_LIMITE:
            return (
                100.0 * courant_v1 / plafond_v1,
                round(courant_v1 / (1024 * 1024), 1),
                round(plafond_v1 / (1024 * 1024), 1),
                "cgroup",
            )

    # ── Repli : pas de cgroup limite (execution locale) ──
    memoire = psutil.virtual_memory()
    return (
        memoire.percent,
        round(memoire.used / (1024 * 1024), 1),
        round(memoire.total / (1024 * 1024), 1),
        "psutil",
    )


def cpu_pourcentage() -> tuple[float, str]:
    """(pourcentage, source) : cgroup si le quota est borne, sinon psutil.

    Quand le CPU est plafonne (``cpu.max`` = quota / periode, ou
    ``cpu.cfs_quota_us``), l'ecart de ``usage_usec`` entre deux appels divise
    par le temps reel ecoule donne directement la part de CPU consommee, ce
    qui est comparable au seuil de 80 %. Sans quota (ou hors conteneur), le
    quota ne bride rien et la lecture psutil du noeud reste la bonne mesure.
    """
    global _cpu_precedent

    cumule = _temps_cpu_cgroup()
    if cumule is None or not _cpu_quota_borne():
        return psutil.cpu_percent(interval=0.1), "psutil"

    precedent_etat = _cpu_precedent
    maintenant = time.monotonic()
    _cpu_precedent = (cumule, maintenant)

    if precedent_etat is None:
        return psutil.cpu_percent(interval=0.1), "psutil"

    precedent, instant_precedent = precedent_etat
    ecoule = max(1e-6, maintenant - instant_precedent)
    return (100.0 * (cumule - precedent) / ecoule, "cgroup")


def _temps_cpu_cgroup() -> float | None:
    """Temps CPU cumule de la contenante, en secondes, ou None."""
    # cgroup v2 : cpu.stat -> usage_usec (microsecondes).
    try:
        with open(f"{_CGROUP_V2}/cpu.stat", encoding="utf-8") as f:
            for ligne in f:
                cle, _, valeur = ligne.partition(" ")
                if cle.strip() == "usage_usec":
                    return float(valeur.strip()) / 1_000_000.0
    except (OSError, ValueError):
        pass

    # cgroup v1 : cpuacct.usage (nanosecondes).
    total = _lire(f"{_CGROUP_V1_CPUACCT}/cpuacct.usage")
    if total is not None:
        return total / 1_000_000_000.0

    return None


def _cpu_quota_borne() -> bool:
    """Vrai si le CPU de la contenante est plafonne par un quota."""
    # cgroup v2 : cpu.max = "<quota> <periode>", "max <periode>" si libre.
    # Ce fichier contient deux champs : on ne lit que le quota.
    try:
        with open(f"{_CGROUP_V2}/cpu.max", encoding="utf-8") as f:
            quota = f.read().split()[0]
    except (OSError, ValueError, IndexError):
        quota = None
    if quota is not None:
        if quota == "max":
            return False
        try:
            return 0 < int(quota) < _SANS_LIMITE
        except ValueError:
            return False
    # cgroup v1
    quota_v1 = _lire("/sys/fs/cgroup/cpu/cpu.cfs_quota_us")
    return quota_v1 is not None and 0 < quota_v1 < _SANS_LIMITE


_cpu_precedent: tuple[float, float] | None = None
