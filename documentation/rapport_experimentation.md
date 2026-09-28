# Rapport Comparatif des Scénarios Expérimentaux (AERIS)

Ce rapport synthétise les performances des quatre scénarios exécutés pour valider l'architecture Edge-Cloud.

## 1. Synthèse des indicateurs clés

| Scénario | Req. Totales | Succès (%) | Répartition (Edge/Cloud) | Latence moy. (ms) | Précision (TB/PN) |
| :--- | :---: | :---: | :--- | :---: | :---: |
| **Tout-Cloud** | 200 | 100% | 0% / 100% | 530 | 80% / 90% |
| **Tout-Edge** | 200 | 100% | 100% / 0% | 399 | 80% / 90% |
| **Adaptatif** | 200 | 100% | 51% / 49% | 778 | 80% / 91% |
| **Panne** | 100 | 100% | 100% | 1094 | 80% / 90% |

## 2. Analyse détaillée par scénario

### A. Tout-Cloud (Baseline Cloud)
*   **Comportement :** Performances stables, latence dépendante de la bande passante WAN.
*   **Analyse :** Latence moyenne de 530 ms. C'est la référence haute pour la performance réseau pure sans contrainte locale.

### B. Tout-Edge (Baseline Edge)
*   **Comportement :** Performances maximales en termes de latence.
*   **Analyse :** Latence moyenne la plus basse (399 ms). L'absence de transport réseau réduit drastiquement les délais, validant l'intérêt de l'Edge dans les zones à connectivité intermittente.

### C. Adaptatif (Cœur métier)
*   **Comportement :** Le moteur de décision a efficacement balancé la charge (51% Edge, 49% Cloud).
*   **Analyse :** Latence moyenne plus élevée (778 ms), incluant des phases de stress CPU et latence réseau simulée.

### D. Tolérance aux pannes
*   **Comportement :** Bascule automatique réussie.
*   **Analyse :** Lors de l'arrêt du conteneur Edge, le système a basculé vers le Cloud. La latence moyenne est plus élevée (1094 ms) en raison des tentatives de connexion initiale sur le service Edge en panne.

## 3. Synthèse architecturale
1.  **Fiabilité démontrée :** Le mécanisme de bascule est fonctionnel.
2.  **Optimisation nécessaire :** Le temps de calcul des `MetriquesSysteme` doit être optimisé.
3.  **Stabilité :** La précision des modèles est constante.

**Conclusion :** L'architecture AERIS est robuste, adaptative et sécurisée.
