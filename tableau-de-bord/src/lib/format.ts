/** Au-delà de cette confiance, le modèle sature et l'arrondi dirait « 100 % ». */
export const SEUIL_SATURATION = 0.995;

/**
 * Confiance → pourcentage affichable.
 *
 * Un modèle sature en float32 sur une part importante des clichés : la
 * valeur est alors exactement 1.0, et un arrondi à l'entier afficherait
 * « 100 % », soit une certitude qu'aucun modèle ne peut établir. Au-delà de
 * `SEUIL_SATURATION` on affiche donc « plus de 99 % » : la confiance est
 * déclarée très élevée, sans être convertie en certitude. La formulation
 * « plus de » se lit aussi bien seule dans un tableau qu'insérée dans une
 * phrase clinique, là où un « > » serait ambigu.
 */
export function formatConfiance(confiance: number): string {
  const c = Math.max(0, Math.min(1, confiance));
  return c >= SEUIL_SATURATION ? "plus de 99 %" : `${Math.round(c * 100)} %`;
}

/** Uptime en secondes → format lisible (ex. « 1 h 05 min »). */
export function formatUptime(secondes: number): string {
  if (!secondes) return "—";
  const h = Math.floor(secondes / 3600);
  const m = Math.floor((secondes % 3600) / 60);
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min`;
  return `${Math.round(secondes)} s`;
}
