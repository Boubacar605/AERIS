import axios from "axios";

const URL_API = import.meta.env.VITE_URL_API || "http://localhost:8003";

const clientApi = axios.create({
  baseURL: URL_API,
  timeout: 30000,
});

export interface MetriquesSysteme {
  cpu_pourcentage: number;
  ram_pourcentage: number;
  latence_reseau_ms: number;
  reseau_disponible: boolean;
}

export interface DecisionRoutage {
  destination: "edge" | "cloud";
  raison: string;
  metriques: MetriquesSysteme;
}

export interface ResultatDiagnostic {
  pathologie: string;
  prediction: string;
  confiance: number;
  temps_inference_ms: number;
}

export interface ReponseRoutage {
  decision: DecisionRoutage;
  resultats: ResultatDiagnostic[];
  temps_total_ms: number;
}

export async function soumettreDiagnostic(
  fichier: File
): Promise<ReponseRoutage> {
  const formData = new FormData();
  formData.append("fichier", fichier);
  const reponse = await clientApi.post<ReponseRoutage>(
    "/routage/analyser",
    formData,
    { headers: { "Content-Type": "multipart/form-data" } }
  );
  return reponse.data;
}

export async function verifierSante(): Promise<{ statut: string }> {
  const reponse = await clientApi.get("/sante");
  return reponse.data;
}

export default clientApi;
