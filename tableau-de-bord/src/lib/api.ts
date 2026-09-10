/**
 * Client API — communication entre le tableau de bord et le moteur de décision.
 *
 * L'URL de base provient de la variable d'environnement VITE_URL_API
 * (définie par docker-compose). En développement local sans variable,
 * on utilise localhost:8003 (port par défaut du moteur de décision).
 */

const BASE_URL = (import.meta.env["VITE_URL_API"] as string | undefined) ?? "http://localhost:8003";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Délai d'attente court pour le polling (le backend doit être réactif). */
const TIMEOUT_POLLING_MS = 4000;

export async function fetchAPI<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    signal: AbortSignal.timeout(TIMEOUT_POLLING_MS),
    ...init,
  });
  if (!res.ok) throw new ApiError(res.status, `API ${res.status} sur ${path}`);
  return (await res.json()) as T;
}

/** Upload d'une radiographie vers /routage/analyser (multipart/form-data). */
export async function uploadImage(
  path: string,
  file: File,
  forceDestination?: string,
): Promise<ReponseRoutage> {
  const form = new FormData();
  form.append("fichier", file);
  if (forceDestination) form.append("force_destination", forceDestination);
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new ApiError(res.status, `API ${res.status} sur ${path}`);
  return (await res.json()) as ReponseRoutage;
}

/* ------------------------------- Types ------------------------------- */

/** Métriques système exposées par GET /etat-systeme. */
export type EtatSysteme = {
  edge?: {
    cpu_pourcentage?: number;
    ram_pourcentage?: number;
    ram_utilisee_mb?: number;
    ram_totale_mb?: number;
    disque_pourcentage?: number;
    mode?: string;
  };
  cloud?: {
    connectivite?: boolean;
    latence_ms?: number;
  };
  tempreel?: {
    debit_requete_par_minute?: number;
    temps_moyen_inference_edge_ms?: number;
    temps_moyen_inference_cloud_ms?: number;
    nb_requetes_total?: number;
  };
  statistiques?: {
    total: number;
    taux_reussite: number;
    latence_moyenne_edge_ms: number;
    latence_moyenne_cloud_ms: number;
    repartition: { edge: number; cloud: number };
  };
  decision?: {
    destination: "edge" | "cloud";
    raison: string;
    metriques: {
      cpu_pourcentage: number;
      ram_pourcentage: number;
      latence_reseau_ms: number;
      reseau_disponible: boolean;
    };
  };
};

/** Résultat d'un diagnostic de pathologie (retourné par le moteur). */
export type ResultatDiagnostic = {
  pathologie: string;
  prediction: string;
  confiance: number;
  temps_inference_ms: number;
};

/** Entrée de l'historique (buffer circulaire du moteur). */
export type DiagnosticHistorique = {
  id: number;
  horodatage: string;
  destination: "edge" | "cloud";
  resultats: ResultatDiagnostic[];
  temps_total_ms: number;
  statut: "completed" | "failed";
};

export type ReponseHistorique = {
  derniers_diagnostics: DiagnosticHistorique[];
  statistiques: {
    total: number;
    taux_reussite: number;
    latence_moyenne_edge_ms: number;
    latence_moyenne_cloud_ms: number;
    repartition: { edge: number; cloud: number };
  };
};

/** Réponse complète de POST /routage/analyser. */
export type ReponseRoutage = {
  decision: {
    destination: "edge" | "cloud";
    raison: string;
    metriques: {
      cpu_pourcentage: number;
      ram_pourcentage: number;
      latence_reseau_ms: number;
      reseau_disponible: boolean;
    };
  };
  resultats: ResultatDiagnostic[];
  temps_total_ms: number;
};

/** Seuils de décision exposés par GET /. */
export type SeuilsMoteur = {
  cpu: number;
  ram: number;
  latence_ms: number;
};

export async function obtenirSeuils(): Promise<SeuilsMoteur> {
  const data = await fetchAPI<{ seuils?: SeuilsMoteur }>("/");
  if (!data.seuils) throw new ApiError(0, "Seuils absents de la réponse racine");
  return data.seuils;
}
