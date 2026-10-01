"""
Generateur de charge pour les scenarios d'experimentation.

Simule des conditions de reseau et de ressources variables sur les services Edge
pour tester le comportement adaptatif du moteur de decision.

Strategie : stimulation applicative dans Docker (pas tc/netem).
"""

import subprocess
import time
from dataclasses import dataclass
from typing import Any


# Noms des conteneurs Docker (doivent correspondre a docker-compose.yml)
_CONTAINERS_EDGE = {
    "tuberculose": "aeris-tb-edge",
    "pneumonie": "aeris-pn-edge",
}
_CONTAINERS_CLOUD = {
    "tuberculose": "aeris-tb-cloud",
    "pneumonie": "aeris-pn-cloud",
}
_CONTAINERMOTEUR = "aeris-moteur-decision"


# Profils de charge supportes
PROFILS_CHARGE = {
    "stable": "Aucune degradation — regime normal (baseline)",
    "reseau_lent": "Latence reseau elevee vers le Cloud (delai applicatif)",
    "reseau_coupure": "Coupure temporaire du reseau Cloud",
    "cpu_sature": "CPU Edge sature via stress-ng",
    "panne_edge": "Service Edge indisponible (arret Docker)",
}


@dataclass
class EtatCharge:
    """Etat actuel du generateur de charge."""

    profil_actif: str
    description: str
    timestamp_debut: float
    duree_secondes: float


class GenerateurCharge:
    """
    Applique et gere des profils de charge sur les services Edge.

    Utilise des commandes Docker et des outils systeme pour simuler
    des conditions de degradation reseau et materielle.
    """

    def __init__(self, est_docker: bool = True) -> None:
        """
        Args:
            est_docker: True si les services tournent dans Docker,
                        False pour un usage hors Docker.
        """
        self._est_docker = est_docker
        self._etat: EtatCharge | None = None
        self._processus_stress: subprocess.Popen | None = None

    @property
    def etat(self) -> EtatCharge | None:
        """Retourne l'etat actuel du generateur."""
        return self._etat

    def appliquer(self, profil: str, duree_secondes: float = 0) -> None:
        """
        Active le profil de charge specifie.

        Args:
            profil: Identifiant du profil (voir PROFILS_CHARGE).
            duree_secondes: Duree d'application (0 = jusqu'au prochain appel).
        """
        if profil not in PROFILS_CHARGE:
            raise ValueError(
                f"Profil inconnu : '{profil}'. "
                f"Profils disponibles : {list(PROFILS_CHARGE.keys())}"
            )

        # Retirer la charge precedente si necessaire
        self.relever()

        print(f"  [CHARGE] Activation du profil : {profil}")
        self._etat = EtatCharge(
            profil_actif=profil,
            description=PROFILS_CHARGE[profil],
            timestamp_debut=time.monotonic(),
            duree_secondes=duree_secondes,
        )

        if profil == "stable":
            # Rien a faire
            pass

        elif profil == "reseau_lent":
            self._appliquer_reseau_lent()

        elif profil == "reseau_coupure":
            self._appliquer_reseau_coupure()

        elif profil == "cpu_sature":
            self._appliquer_cpu_sature()

        elif profil == "panne_edge":
            self._appliquer_panne_edge()

    def relever(self) -> None:
        """Desactive toute charge en cours et restaure l'etat normal."""
        if self._etat is None:
            return

        profil = self._etat.profil_actif
        print(f"  [CHARGE] Retrait du profil : {profil}")

        if profil == "reseau_lent":
            self._relever_reseau_lent()
        elif profil == "reseau_coupure":
            self._relever_reseau_coupure()
        elif profil == "cpu_sature":
            self._relever_cpu_sature()
        elif profil == "panne_edge":
            self._relever_panne_edge()

        self._etat = None

    def appliquer_profil_sequence(self, profils: list[dict[str, Any]]) -> None:
        """
        Applique une sequence de profils de charge.

        Args:
            profils: Liste de dicts {"profil": str, "duree_secondes": float}.
        """
        for i, config in enumerate(profils):
            profil = config["profil"]
            duree = config.get("duree_secondes", 30)

            print(f"\n  === Phase {i + 1}/{len(profils)} : {profil} ({duree}s) ===")
            self.appliquer(profil, duree)

            if duree > 0:
                print(f"  [CHARGE] Maintien pendant {duree} secondes...")
                time.sleep(duree)

        # Retirer la charge a la fin
        self.relever()

    # === Implementation des profils ===

    def _appliquer_reseau_lent(self) -> None:
        """
        Simule une latence reseau elevee vers le Cloud.

        Les services Cloud exposent un endpoint /sante qui ajoute un delai
        applicatif de ``LATENCE_SIMULEE`` millisecondes quand le fichier
        ``/tmp/latence-simulee-ms`` existe dans leur conteneur. Ecrire ce
        fichier rend le Cloud réellement plus lent a repondre, ce que le
        moteur de decision mesure via son evaluation de latence (regle
        "latence > seuil -> Edge"). Le delai est retabli a 0 par
        ``_relever_reseau_lent``.
        """
        if self._est_docker:
            valeur = "300"
            for container in _CONTAINERS_CLOUD.values():
                self._executer_docker(
                    ["exec", container, "sh", "-c",
                     f"echo {valeur} > /tmp/latence-simulee-ms"]
                )
            print(f"  [CHARGE] Latence simulee de {valeur}ms injectee vers le Cloud")

    def _relever_reseau_lent(self) -> None:
        """Supprime le delai applicatif injecte sur les services Cloud."""
        if self._est_docker:
            for container in _CONTAINERS_CLOUD.values():
                self._executer_docker(
                    ["exec", container, "sh", "-c",
                     "rm -f /tmp/latence-simulee-ms"]
                )
            print("  [CHARGE] Latence simulee retablie (0ms)")

    def _appliquer_reseau_coupure(self) -> None:
        """
        Simule une coupure reseau vers le Cloud.

        Arrete temporairement le service tuberculose Cloud pour que
        les healthchecks du moteur de decision echouent.
        """
        if self._est_docker:
            for container in ["aeris-tb-cloud", "aeris-pn-cloud"]:
                self._executer_docker(["stop", container])
            print("  [CHARGE] Services Cloud arretes (coupure simulee)")

    def _relever_reseau_coupure(self) -> None:
        """Redemarre les services Cloud arretes."""
        if self._est_docker:
            for container in ["aeris-tb-cloud", "aeris-pn-cloud"]:
                self._executer_docker(["start", container])
            print("  [CHARGE] Services Cloud redemarres")

    _MARQUEUR_SATURATION = "while True: pass"

    def _appliquer_cpu_sature(self) -> None:
        """
        Simule une saturation CPU sur les services Edge.

        Prefere stress-ng quand il est disponible dans le conteneur,
        sinon lance des boucles Python inline (aucune dependance apt :
        une installation a chaud sous timeout laisserait des orphelins
        apt-get verrouillant dpkg).
        """
        if not self._est_docker:
            print("  [CHARGE] Mode non-Docker : saturation CPU non simulable")
            return
        for container in _CONTAINERS_EDGE.values():
            presence = self._executer_docker(
                ["exec", container, "sh", "-c", "command -v stress-ng || true"]
            )
            if "stress-ng" in presence.stdout:
                self._executer_docker(
                    ["exec", "-d", container, "sh", "-c",
                     "stress-ng --cpu 4 --timeout 300s"]
                )
            else:
                self._executer_docker(
                    ["exec", "-d", container, "sh", "-c",
                     f"for i in 1 2 3 4; do python3 -c "
                     f"\"{self._MARQUEUR_SATURATION}\" & done; wait"]
                )
        print("  [CHARGE] Saturation CPU lancee sur les conteneurs Edge (4 processus)")

    def _relever_cpu_sature(self) -> None:
        """Arrete les processus de stress (stress-ng ou boucles Python)."""
        if self._est_docker:
            for container in _CONTAINERS_EDGE.values():
                self._executer_docker(
                    ["exec", container, "sh", "-c",
                     "for p in /proc/[0-9]*; do cmd=$(cat $p/cmdline "
                     "2>/dev/null | tr '\\0' ' '); "
                     "case \"$cmd\" in *\"while True: pass\"*|*stress-ng*) "
                     "kill -9 ${p#/proc/} 2>/dev/null;; esac; done"]
                )
            print("  [CHARGE] Saturation CPU arretee sur les conteneurs Edge")

    def _appliquer_panne_edge(self) -> None:
        """
        Simule une panne du service Edge.

        Arrete les conteneurs Docker des deux services Edge (TB et PN) :
        une panne d'infrastructure locale touche l'ensemble du noeud.
        """
        if self._est_docker:
            for container in _CONTAINERS_EDGE.values():
                self._executer_docker(["stop", container])
                print(f"  [CHARGE] Conteneur {container} arrete")

    def _relever_panne_edge(self) -> None:
        """Redemarre les services Edge arretes."""
        if self._est_docker:
            for container in _CONTAINERS_EDGE.values():
                self._executer_docker(["start", container])
                print(f"  [CHARGE] Conteneur {container} demarre")

    def _executer_docker(self, commande: list[str]) -> subprocess.CompletedProcess:
        """Execute une commande docker et retourne le resultat."""
        cmd_complet = ["docker"] + commande
        try:
            result = subprocess.run(
                cmd_complet,
                capture_output=True,
                text=True,
                timeout=30,
            )
            if result.returncode != 0 and result.stderr.strip():
                print(f"  [AVERTISSEMENT] Erreur Docker : {result.stderr.strip()}")
            return result
        except FileNotFoundError:
            print("  [AVERTISSEMENT] Docker non trouve. Commande non executee.")
            return subprocess.CompletedProcess(cmd_complet, 1, "", "Docker non disponible")
        except subprocess.TimeoutExpired:
            print(f"  [AVERTISSEMENT] Timeout Docker : {' '.join(cmd_complet)}")
            return subprocess.CompletedProcess(cmd_complet, 1, "", "Timeout")
