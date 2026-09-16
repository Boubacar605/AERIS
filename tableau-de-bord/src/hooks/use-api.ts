/**
 * Hooks de données connectés au moteur de décision.
 *
 * Aucun repli sur des données fictives : chaque hook reflète l'état réel du
 * backend. Trois états possibles :
 * - "chargement"   : première requête en cours, aucune donnée encore ;
 * - "live"         : le backend a répondu, les données exposées sont réelles ;
 * - "indisponible" : le backend est injoignable, aucune valeur de secours.
 */

import { useEffect, useState } from "react";

import {
  fetchAPI,
  obtenirSeuils,
  type DiagnosticHistorique,
  type EtatSysteme,
  type ReponseHistorique,
  type SeuilsMoteur,
} from "@/lib/api";
import type { InferenceRecord, Telemetry } from "@/lib/aeris";

export type EtatConnexion = "chargement" | "live" | "indisponible";

/* ------------------- Santé des services IA ------------------- */

export type ServiceHealth = {
  nom: string;
  statut: string;
  mode: string;
  uptime_secondes: number;
  latence_ms: number;
};

export type SanteServices = Record<string, ServiceHealth>;

export function useServiceHealthLive(intervalMs = 8000): {
  sante: SanteServices;
  etat: EtatConnexion;
  refresh: () => void;
} {
  const [sante, setSante] = useState<SanteServices>({});
  const [etat, setEtat] = useState<EtatConnexion>("chargement");
  const [pulsation, setPulsation] = useState(0);

  useEffect(() => {
    let actif = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function sonder() {
      try {
        const data = await fetchAPI<SanteServices>("/sante-services");
        if (!actif) return;
        setSante(data);
        setEtat("live");
      } catch {
        if (!actif) return;
        setSante({});
        setEtat("indisponible");
      }
      if (!actif) return;
      timer = setTimeout(sonder, intervalMs);
    }

    void sonder();
    return () => {
      actif = false;
      if (timer) clearTimeout(timer);
    };
  }, [intervalMs, pulsation]);

  const refresh = () => {
    setEtat("chargement");
    setSante({});
    setPulsation((p) => p + 1);
  };

  return { sante, etat, refresh };
}

/* ------------------- Conversion des réponses du moteur ------------------- */

const SERVICE_PN = "Classificateur Pneumonie" as const;
const SERVICE_TB = "Classificateur Tuberculose" as const;

/** Convertit un diagnostic du moteur vers les lignes d'activité de l'UI. */
function mapDiagnosticVersRecords(d: DiagnosticHistorique): InferenceRecord[] {
  return d.resultats.map((r) => {
    const pathologieTB = r.pathologie === "tuberculose";
    const finding =
      r.prediction === "positif"
        ? pathologieTB
          ? "Suspicion de tuberculose"
          : "Suspicion de pneumonie"
        : "Examen normal";
    return {
      id: d.id,
      time: new Date(d.horodatage.replace("T", " ")).toTimeString().slice(0, 8),
      service: pathologieTB ? SERVICE_TB : SERVICE_PN,
      confidence: Math.round(r.confiance * 100),
      target: d.destination,
      latencyMs: Math.round(r.temps_inference_ms),
      status: d.statut,
      finding,
    };
  });
}

/** Extrait la télémétrie réelle des sections edge/cloud/tempreel. */
function telemetryDepuisEtat(etat: EtatSysteme): Telemetry {
  const edge = etat.edge ?? {};
  const cloud = etat.cloud ?? {};
  const tps = etat.tempreel ?? {};
  return {
    edgeCpu: Math.round(edge.cpu_pourcentage ?? 0),
    edgeRam: Math.round(edge.ram_pourcentage ?? 0),
    edgeDisk: Math.round(edge.disque_pourcentage ?? 0),
    latence_reseau_ms: cloud.latence_ms ?? 9999,
    reseau_disponible: cloud.connectivite ?? false,
    throughput: Math.round(tps.debit_requete_par_minute ?? 0),
    edgeInference: Math.round(tps.temps_moyen_inference_edge_ms ?? 0),
    cloudInference: Math.round(tps.temps_moyen_inference_cloud_ms ?? 0),
  };
}

/* ------------------- État système : télémétrie + décision ------------------- */

export type DecisionTempsReel = {
  destination: "edge" | "cloud";
  raison: string;
  metriques: {
    cpu_pourcentage: number;
    ram_pourcentage: number;
    latence_reseau_ms: number;
    reseau_disponible: boolean;
  };
  requetes: { edge: number; cloud: number };
};

export function useEtatSysteme(intervalMs = 3000): {
  telemetry: Telemetry | null;
  decision: DecisionTempsReel | null;
  nbRequetesTotal: number;
  etat: EtatConnexion;
  refresh: () => void;
} {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [decision, setDecision] = useState<DecisionTempsReel | null>(null);
  const [nbRequetesTotal, setNbRequetesTotal] = useState(0);
  const [etat, setEtat] = useState<EtatConnexion>("chargement");
  const [pulsation, setPulsation] = useState(0);

  useEffect(() => {
    let actif = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function sonder() {
      try {
        const systeme = await fetchAPI<EtatSysteme>("/etat-systeme");
        if (!actif) return;
        setTelemetry(telemetryDepuisEtat(systeme));
        setNbRequetesTotal(systeme.tempreel?.nb_requetes_total ?? 0);
        setDecision({
          destination: systeme.decision?.destination ?? "edge",
          raison: systeme.decision?.raison ?? "",
          metriques: systeme.decision?.metriques ?? {
            cpu_pourcentage: 0,
            ram_pourcentage: 0,
            latence_reseau_ms: 0,
            reseau_disponible: false,
          },
          requetes: systeme.statistiques?.repartition ?? { edge: 0, cloud: 0 },
        });
        setEtat("live");
      } catch {
        if (!actif) return;
        setTelemetry(null);
        setDecision(null);
        setEtat("indisponible");
      }
      if (!actif) return;
      timer = setTimeout(sonder, intervalMs);
    }

    void sonder();
    return () => {
      actif = false;
      if (timer) clearTimeout(timer);
    };
  }, [intervalMs, pulsation]);

  const refresh = () => {
    setEtat("chargement");
    setTelemetry(null);
    setDecision(null);
    setPulsation((p) => p + 1);
  };

  return { telemetry, decision, nbRequetesTotal, etat, refresh };
}

/* ----------------------------- Statistiques ----------------------------- */

export type StatsHistorique = {
  total: number;
  tauxReussite: number;
  avgLatencyEdge: number;
  avgLatencyCloud: number;
  counts: Record<"edge" | "cloud", number>;
};

const STATS_VIDES: StatsHistorique = {
  total: 0,
  tauxReussite: 0,
  avgLatencyEdge: 0,
  avgLatencyCloud: 0,
  counts: { edge: 0, cloud: 0 },
};

function statsDepuisBackend(s: ReponseHistorique["statistiques"]): StatsHistorique {
  return {
    total: s.total,
    tauxReussite: s.taux_reussite,
    avgLatencyEdge: Math.round(s.latence_moyenne_edge_ms),
    avgLatencyCloud: Math.round(s.latence_moyenne_cloud_ms),
    counts: {
      edge: s.repartition.edge,
      cloud: s.repartition.cloud,
    },
  };
}

export function useHistoriqueLive(intervalMs = 5000): {
  records: InferenceRecord[];
  statistiques: StatsHistorique;
  etat: EtatConnexion;
  charger: () => Promise<void>;
} {
  const [records, setRecords] = useState<InferenceRecord[]>([]);
  const [statistiques, setStatistiques] = useState<StatsHistorique>(STATS_VIDES);
  const [etat, setEtat] = useState<EtatConnexion>("chargement");

  async function charger() {
    try {
      const hist = await fetchAPI<ReponseHistorique>("/historique");
      setRecords(hist.derniers_diagnostics.flatMap(mapDiagnosticVersRecords).slice(0, 40));
      setStatistiques(statsDepuisBackend(hist.statistiques));
      setEtat("live");
    } catch {
      setRecords([]);
      setStatistiques(STATS_VIDES);
      setEtat("indisponible");
    }
  }

  useEffect(() => {
    let actif = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function sonder() {
      await charger();
      if (!actif) return;
      timer = setTimeout(sonder, intervalMs);
    }

    void sonder();
    return () => {
      actif = false;
      if (timer) clearTimeout(timer);
    };
  }, [intervalMs]);

  return { records, statistiques, etat, charger };
}

/* ----------------------------- Seuils de décision ----------------------------- */

export type Seuils = {
  cpu: number;
  ram: number;
  latence_ms: number;
};

export function useSeuilsLive(intervalMs = 20_000): {
  seuils: Seuils | null;
  etat: EtatConnexion;
  refresh: () => void;
} {
  const [seuils, setSeuils] = useState<Seuils | null>(null);
  const [etat, setEtat] = useState<EtatConnexion>("chargement");
  const [pulsation, setPulsation] = useState(0);

  useEffect(() => {
    let actif = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function sonder() {
      try {
        const data: SeuilsMoteur = await obtenirSeuils();
        if (!actif) return;
        setSeuils({ cpu: data.cpu, ram: data.ram, latence_ms: data.latence_ms });
        setEtat("live");
      } catch {
        if (!actif) return;
        setSeuils(null);
        setEtat("indisponible");
      }
      if (!actif) return;
      timer = setTimeout(sonder, intervalMs);
    }

    void sonder();
    return () => {
      actif = false;
      if (timer) clearTimeout(timer);
    };
  }, [intervalMs, pulsation]);

  const refresh = () => {
    setEtat("chargement");
    setSeuils(null);
    setPulsation((p) => p + 1);
  };

  return { seuils, etat, refresh };
}
