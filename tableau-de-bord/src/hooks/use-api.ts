/**
 * Hooks de données connectés au moteur de décision.
 *
 * Aucun repli sur des données fictives : chaque hook reflète l'état réel du
 * backend. Trois états possibles :
 * - "chargement"   : première requête en cours, aucune donnée encore ;
 * - "live"         : le backend a répondu, les données exposées sont réelles ;
 * - "indisponible" : le backend est injoignable, aucune valeur de secours.
 */

import { useCallback, useEffect, useState } from "react";

import {
  fetchAPI,
  listerDossiersPatients,
  lireFileTriage,
  lireProtocoleValidation,
  lireSynthesePoste,
  listerSuivis,
  lireChronologiePatient,
  obtenirSeuils,
  type ChronologiePatient,
  type DiagnosticHistorique,
  type DossierClinique,
  type EtatSysteme,
  type ReponseHistorique,
  type SeuilsMoteur,
  type FileTriage,
  type ProtocoleValidation,
  type SynthesePoste,
  type SuiviClinique,
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
      confidence: r.confiance,
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

/**
 * Journal des diagnostics, rafraîchi périodiquement.
 *
 * @param intervalMs période de rafraîchissement (le tableau de bord suit le
 *   temps réel, l'historique se contente d'un rythme plus calme).
 * @param limite nombre de diagnostics demandés au moteur. La fenêtre mémoire
 *   du moteur est plafonnée à 100 entrées : au-delà, seule la lecture du
 *   journal durable PostgreSQL remonte les diagnostics plus anciens.
 */
export function useHistoriqueLive(
  intervalMs = 5000,
  limite = 100,
): {
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
      const hist = await fetchAPI<ReponseHistorique>(`/historique?limite=${limite}`);
      setRecords(hist.derniers_diagnostics.flatMap(mapDiagnosticVersRecords).slice(0, limite));
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

/* ------------------- Dossier clinique et suivis (Vague 1) ---------------- */

/**
 * Dossiers patients vus par le clinicien.
 *
 * Rafraîchissement manuel et non cyclique : la liste sert à orienter la
 * priorité du poste, elle n'a pas vocation à être un flux temps réel. Un
 * polling gaspillerait le trafic du réseau faible — le contexte même du
 * projet — pour une information qui change au rythme des examens, pas à la
 * seconde.
 */
export function useDossiersPatients(): {
  dossiers: DossierClinique[];
  etat: EtatConnexion;
  charger: () => Promise<void>;
} {
  const [dossiers, setDossiers] = useState<DossierClinique[]>([]);
  const [etat, setEtat] = useState<EtatConnexion>("chargement");

  const charger = useCallback(async () => {
    try {
      setDossiers(await listerDossiersPatients());
      setEtat("live");
    } catch {
      setDossiers([]);
      setEtat("indisponible");
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  return { dossiers, etat, charger };
}

/**
 * Chronologie d'un dossier, rechargée à la demande.
 *
 * Elle n'est demandée qu'au clic sur une ligne : charger 6examens de 6patients
 * pour n'en afficher qu'un serait du gaspillage sur une liaison satellite.
 */
export function useChronologiePatient(codePatient: string | null): {
  chronologie: ChronologiePatient | null;
  etat: EtatConnexion;
  charger: () => Promise<void>;
} {
  const [chronologie, setChronologie] = useState<ChronologiePatient | null>(null);
  const [etat, setEtat] = useState<EtatConnexion>("chargement");

  const charger = useCallback(async () => {
    if (!codePatient) {
      setChronologie(null);
      setEtat("chargement");
      return;
    }
    try {
      setChronologie(await lireChronologiePatient(codePatient));
      setEtat("live");
    } catch {
      setChronologie(null);
      setEtat("indisponible");
    }
  }, [codePatient]);

  useEffect(() => {
    void charger();
  }, [charger]);

  return { chronologie, etat, charger };
}

/**
 * Contrôles à venir.
 *
 * Rafraîchissement après chaque écriture (programmer, clore) plutôt que
 * périodique : un suivi bouge parce qu'un soignant l'agit, pas parce que
 * l'heure passe.
 */
export function useSuivisCliniques(): {
  suivis: SuiviClinique[];
  etat: EtatConnexion;
  charger: () => Promise<void>;
} {
  const [suivis, setSuivis] = useState<SuiviClinique[]>([]);
  const [etat, setEtat] = useState<EtatConnexion>("chargement");

  const charger = useCallback(async () => {
    try {
      setSuivis(await listerSuivis());
      setEtat("live");
    } catch {
      setSuivis([]);
      setEtat("indisponible");
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  return { suivis, etat, charger };
}

/**
 * File de triage (Vague 2) : la file est rafraîchie par l'utilisateur, pas en
 * boucle. Un balayage automatique effacerait la ligne qu'il est en train
 * de valider.
 */
export function useFileTriage(seuilAlerteJours = 2): {
  file: FileTriage | null;
  etat: EtatConnexion;
  recharger: () => Promise<void>;
} {
  const [file, setFile] = useState<FileTriage | null>(null);
  const [etat, setEtat] = useState<EtatConnexion>("chargement");

  const recharger = useCallback(async () => {
    try {
      setFile(await lireFileTriage(seuilAlerteJours));
      setEtat("live");
    } catch {
      setFile(null);
      setEtat("indisponible");
    }
  }, [seuilAlerteJours]);

  useEffect(() => {
    void recharger();
  }, [recharger]);

  return { file, etat, recharger };
}

/**
 * Agrégats de protocole (Vague 2). Instantané, pas de polling : ces chiffres
 * changent quand un clinicien valide, donc à sa main. Un balayage automatique
 * ferait clignoter les compteurs pendant la lecture.
 */
export function useProtocoleValidation(): {
  protocole: ProtocoleValidation | null;
  etat: EtatConnexion;
  recharger: () => Promise<void>;
} {
  const [protocole, setProtocole] = useState<ProtocoleValidation | null>(null);
  const [etat, setEtat] = useState<EtatConnexion>("chargement");

  const recharger = useCallback(async () => {
    try {
      setProtocole(await lireProtocoleValidation());
      setEtat("live");
    } catch {
      setProtocole(null);
      setEtat("indisponible");
    }
  }, []);

  useEffect(() => {
    void recharger();
  }, [recharger]);

  return { protocole, etat, recharger };
}

/**
 * Synthèse du poste (tableau de bord clinicien).
 *
 * Instantané, comme `useProtocoleValidation` : ces compteurs changent quand un
 * clinicien valide un examen, donc à sa main. Un balayage automatique ferait
 * clignoter les chiffres sous les yeux de celui qui les lit — et pourrait
 * rendre un compteur incohérent avec la ligne qu'il vient de valider.
 *
 * `synthese` reste `null` en cas d'échec : la page affiche « indisponible »
 * plutôt que des zéros, qui se liraient comme une file vide.
 */
export function useSynthesePoste(seuilAlerteJours = 2): {
  synthese: SynthesePoste | null;
  etat: EtatConnexion;
  recharger: () => Promise<void>;
} {
  const [synthese, setSynthese] = useState<SynthesePoste | null>(null);
  const [etat, setEtat] = useState<EtatConnexion>("chargement");

  const recharger = useCallback(async () => {
    try {
      setSynthese(await lireSynthesePoste(seuilAlerteJours));
      setEtat("live");
    } catch {
      setSynthese(null);
      setEtat("indisponible");
    }
  }, [seuilAlerteJours]);

  useEffect(() => {
    void recharger();
  }, [recharger]);

  return { synthese, etat, recharger };
}
