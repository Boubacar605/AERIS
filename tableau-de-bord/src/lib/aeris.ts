import { useEffect, useRef, useState } from "react";

/**
 * Types et utilitaires partagés du tableau de bord.
 *
 * Aucune donnée fictive : les seules valeurs présentées à l'utilisateur
 * proviennent du backend (hooks dans `@/hooks/use-api`). Ce module ne contient
 * que des types et des petits utilitaires purs (horloge, séries temporelles).
 */

/** Destination d'exécution choisie par le moteur de décision. */
export type Target = "edge" | "cloud";

/** Télémétrie système réelle exposée par GET /etat-systeme. */
export type Telemetry = {
  edgeCpu: number;
  edgeRam: number;
  edgeDisk: number;
  latence_reseau_ms: number;
  reseau_disponible: boolean;
  throughput: number;
  edgeInference: number;
  cloudInference: number;
};

/** Ligne d'activité d'un diagnostic (dérivée de l'historique du moteur). */
export type InferenceRecord = {
  id: number;
  time: string;
  service: "Classificateur Tuberculose" | "Classificateur Pneumonie";
  confidence: number;
  target: Target;
  latencyMs: number;
  status: "completed" | "failed";
  finding: string;
};

/** Rolling series used by sparklines and time charts. */
export function useSeries(value: number, length = 32) {
  const [series, setSeries] = useState<number[]>(() => Array.from({ length }, () => value));
  const ref = useRef(value);
  ref.current = value;
  useEffect(() => {
    setSeries((s) => [...s.slice(1), ref.current]);
  }, [value, length]);
  return series;
}

export function useClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}
