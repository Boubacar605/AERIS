/** Uptime en secondes → format lisible (ex. « 1 h 05 min »). */
export function formatUptime(secondes: number): string {
  if (!secondes) return "—";
  const h = Math.floor(secondes / 3600);
  const m = Math.floor((secondes % 3600) / 60);
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min`;
  return `${Math.round(secondes)} s`;
}
