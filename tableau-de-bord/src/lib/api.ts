/**
 * Client API — communication entre le tableau de bord et le moteur de décision.
 *
 * L'URL de base provient de la variable d'environnement VITE_URL_API
 * (définie par docker-compose). En développement local sans variable,
 * on utilise localhost:8003 (port par défaut du moteur de décision).
 *
 * Depuis l'introduction du RBAC, chaque requête porte le jeton d'accès de la
 * session courante. Un 401 déclenche une tentative de rafraîchissement
 * unique ; si le refresh échoue, la session est clôturée (déconnexion).
 */

import {
  deconnecter,
  definirSession,
  obtenirSession,
  type RoleUtilisateur,
} from "@/lib/authentification-store";

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

/**
 * Délai généreux pour les mutations qui déclenchent des envois sortants
 * (email SMTP + relais WhatsApp) : le backend peut légitimement dépasser
 * 4 s alors qu'il a déjà envoyé l'OTP. Un timeout trop court fait croire à
 * un échec alors que le patient a bien reçu le message.
 */
const TIMEOUT_MUTATION_MS = 30_000;

/** Injecte le Bearer token de la session courante dans les en-têtes. */
function avecAuthentification(headers: Headers): void {
  const session = obtenirSession();
  if (session?.acces_token) headers.set("Authorization", `Bearer ${session.acces_token}`);
}

/**
 * Construit un signal d'abandon avec délai, sans planter sur les navigateurs
 * qui ne connaissent pas `AbortSignal.timeout()` (iOS Safari < 15.4). Si la
 * méthode n'existe pas, renvoie `undefined` : le fetch s'exécute sans timer,
 * c'est un simple confort — jamais une cause d'échec.
 */
function signalAvecTimeout(timeoutMs: number): AbortSignal | null {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  return null;
}

/** Tente de renouveler le jeton d'accès. Retourne faux (et déconnecte) sinon. */
async function tenterRafraichir(): Promise<boolean> {
  const session = obtenirSession();
  if (!session?.rafraichissement_token) {
    deconnecter();
    return false;
  }
  try {
    const res = await fetch(`${BASE_URL}/auth/rafraichir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rafraichissement_token: session.rafraichissement_token }),
      signal: signalAvecTimeout(TIMEOUT_POLLING_MS),
    });
    if (!res.ok) {
      deconnecter();
      return false;
    }
    const donnees = (await res.json()) as { acces_token: string };
    definirSession({ ...session, acces_token: donnees.acces_token });
    return true;
  } catch {
    deconnecter();
    return false;
  }
}

export async function fetchAPI<T>(
  path: string,
  init?: RequestInit,
  retente = false,
  timeoutMs = TIMEOUT_POLLING_MS,
): Promise<T> {
  const headers = new Headers(init?.headers);
  avecAuthentification(headers);
  // On extrait `signal` de init pour éviter que le spread ne réintroduise
  // `undefined` (interdit par exactOptionalPropertyTypes).
  const { signal: _s, ...rest } = init ?? {};
  const res = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    signal: signalAvecTimeout(timeoutMs),
    headers,
  });
  // Jeton expiré : un seul refresh, puis une seule nouvelle tentative.
  if (res.status === 401 && !retente && (await tenterRafraichir())) {
    return fetchAPI<T>(path, init, true, timeoutMs);
  }
  if (!res.ok) throw new ApiError(res.status, `API ${res.status} sur ${path}`);
  return (await res.json()) as T;
}

/** Upload d'une radiographie vers /routage/analyser (multipart/form-data). */
export async function uploadImage(
  path: string,
  file: File,
  forceDestination?: string,
  contexte?: ContexteDepistage,
  codePatient?: string,
): Promise<ReponseRoutage> {
  const form = new FormData();
  form.append("fichier", file);
  if (forceDestination) form.append("force_destination", forceDestination);
  if (contexte && contexte !== "auto") form.append("contexte", contexte);
  if (codePatient) form.append("code_patient", codePatient);
  const headers = new Headers();
  avecAuthentification(headers);
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    body: form,
    headers,
    signal: signalAvecTimeout(30_000),
  });
  if (!res.ok) throw new ApiError(res.status, `API ${res.status} sur ${path}`);
  return (await res.json()) as ReponseRoutage;
}

/* ------------------------- Flux patient automatique ------------------------ */

/**
 * En-tête patient rempli par le clinicien sur la page Diagnostic AVANT
 * l'upload : nom, prénom, date de naissance, email (optionnel) et téléphone
 * (obligatoire). Le code patient est généré automatiquement par le moteur.
 */
export type EnTetePatient = {
  nom: string;
  prenom: string;
  date_naissance?: string | null;
  email?: string | null;
  telephone: string;
};

/** Réponse de POST /routage/patient — patient créé ou compte réutilisé. */
export type ReponseEnTetePatient = {
  id_patient: number;
  code_patient: string;
  nom_complet: string | null;
  deja_enregistre: boolean;
};

/** POST /routage/patient — crée (code AER-AAAA-NNNN) ou retrouve le patient. */
export async function trouverOuCreerPatient(enTete: EnTetePatient): Promise<ReponseEnTetePatient> {
  return fetchAPI<ReponseEnTetePatient>(
    "/routage/patient",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(enTete),
    },
    false,
    TIMEOUT_MUTATION_MS,
  );
}

/** Réponse de l'approbation : le patient reçoit son OTP par email et/ou WhatsApp. */
export type ReponseApprobation = {
  statut: "otp_envoye" | "echec_envoi";
  canal: "email+whatsapp" | "whatsapp" | "email" | "aucun";
  contact?: string;
};

/**
 * POST /admin/examens/approuver — bouton « Approuver » de la page Résultat :
 * envoie le code OTP validé au patient (email + WhatsApp si adresse connue,
 * sinon WhatsApp seul ; le lien de consultation reste dans chaque message).
 */
export async function approuverExamen(codePatient: string): Promise<ReponseApprobation> {
  return fetchAPI<ReponseApprobation>(
    "/admin/examens/approuver",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code_patient: codePatient }),
    },
    false,
    TIMEOUT_MUTATION_MS,
  );
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
  /** Source réelle du verdict retenu : "edge" ou "cloud". */
  source?: "edge" | "cloud";
  /** Vrai si ce verdict a subi un contrôle qualité (escalade). */
  escalade?: boolean;
  /** Confiance avant escalade (trace du contrôle). */
  confiance_initiale?: number;
  /** Source avant escalade (trace du contrôle). */
  source_initiale?: "edge" | "cloud";
  /** Vrai si le verdict est trop ambigu pour être utilisé (relecture requise). */
  indetermine?: boolean;
};

/** Événement tracé d'un contrôle qualité (escalade Edge ↔ Cloud). */
export type EvenementEscalade = {
  pathologie: string;
  source_initiale: "edge" | "cloud";
  confiance_initiale: number;
  source_controle: "edge" | "cloud";
  confiance_controle: number;
  decision: "arbitrage_a_prevalu" | "arbitrage_conserve_initial" | "escalade_impossible";
  raison: string;
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

/** Profil technique d'une image extrait par le moteur (routage sélectif). */
export type ProfilImage = {
  nom_fichier?: string | null;
  format?: string | null;
  largeur_px?: number | null;
  hauteur_px?: number | null;
  ratio_largeur_hauteur?: number | null;
  mode_canaux?: string | null;
  taille_octets?: number;
  indecodable?: boolean;
};

/** Décision de triage des spécialistes après profilage de l'image. */
export type FiltrageSpecialistes = {
  profil: ProfilImage;
  specialistes_admissibles: string[];
  regle_appliquee: string;
  cle_regle?: string;
  specialiste_ecarte?: string | null;
  raison: string;
};

/** Contexte de dépistage saisi par le soignant ("auto" = profilage seul). */
export type ContexteDepistage = "auto" | "tuberculose" | "pneumonie" | "general";

/**
 * Forme « prête à afficher » du résultat d'analyse, produite par la page
 * Diagnostic à partir de ReponseRoutage (décision aplatie, champs fiabilisés).
 */
export type ResultatAnalyse = {
  destination: "edge" | "cloud";
  raison: string;
  metriques: {
    cpu_pourcentage: number;
    ram_pourcentage: number;
    latence_reseau_ms: number;
    reseau_disponible: boolean;
  };
  resultats: ResultatDiagnostic[];
  escalades: EvenementEscalade[];
  temps_total_ms: number;
  temps_escalade_ms: number | null;
  /** Profilage de l'image et triage des spécialistes, si fourni par le moteur. */
  filtrage?: FiltrageSpecialistes;
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
  escalades: EvenementEscalade[];
  temps_total_ms: number;
  temps_escalade_ms: number | null;
  filtrage?: FiltrageSpecialistes;
};

/** Seuils de décision exposés par GET /. */
export type SeuilsMoteur = {
  cpu: number;
  ram: number;
  latence_ms: number;
  confiance_escalade?: number;
  confiance_indetermine?: number;
  profilage_active?: boolean;
  profilage?: {
    seuil_ratio_carre_inf?: number;
    seuil_ratio_carre_sup?: number;
    seuil_ratio_pn?: number;
    format_image_tb?: string;
    format_image_pn?: string;
  };
};

export async function obtenirSeuils(): Promise<SeuilsMoteur> {
  const data = await fetchAPI<{ seuils?: SeuilsMoteur }>("/");
  if (!data.seuils) throw new ApiError(0, "Seuils absents de la réponse racine");
  return data.seuils;
}

/* --------------------------- Authentification --------------------------- */

/** Personne restituée par le backend (profil de la session). */
export type Personne = {
  id_utilisateur: number;
  email: string;
  nom: string;
  prenom: string;
  role: RoleUtilisateur;
  actif?: boolean;
};

export type ReponseConnexion = {
  acces_token: string;
  rafraichissement_token: string;
  personne: Personne;
};

/** POST /auth/connexion — email + mot de passe -> tokens + profil. */
export async function connexion(email: string, motDePasse: string): Promise<ReponseConnexion> {
  const data = await fetchAPI<ReponseConnexion>(
    "/auth/connexion",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, mot_de_passe: motDePasse }),
    },
    false,
    TIMEOUT_MUTATION_MS,
  );
  return data;
}

/* ------------------------------- Administration -------------------------- */

export type UtilisateurAdmin = Personne;

export type CreerUtilisateurRequete = {
  email: string;
  nom: string;
  prenom: string;
  role: RoleUtilisateur;
  mot_de_passe: string;
};

export type PatientAdmin = {
  id_patient: number;
  code_patient: string;
  nom_complet: string | null;
  email: string | null;
  telephone: string | null;
  sexe: string | null;
  annee_naissance: number | null;
  note: string | null;
  cree_le?: string | null;
  nom?: string | null;
  prenom?: string | null;
  date_naissance?: string | null;
};

export type CreerPatientRequete = {
  /** Optionnel depuis le flux automatique : AER-AAAA-NNNN si absent. */
  code_patient?: string | null;
  nom_complet?: string | null;
  email?: string | null;
  telephone?: string | null;
  sexe?: string | null;
  annee_naissance?: number | null;
  note?: string | null;
  nom?: string | null;
  prenom?: string | null;
  date_naissance?: string | null;
};

export async function listerUtilisateurs(): Promise<UtilisateurAdmin[]> {
  return fetchAPI<UtilisateurAdmin[]>("/admin/utilisateurs");
}

export async function creerUtilisateur(
  requete: CreerUtilisateurRequete,
): Promise<UtilisateurAdmin> {
  return fetchAPI<UtilisateurAdmin>(
    "/admin/utilisateurs",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requete),
    },
    false,
    TIMEOUT_MUTATION_MS,
  );
}

/** PATCH /admin/utilisateurs/{id} — active/désactive un compte ou change son rôle. */
export async function modifierUtilisateur(
  id: number,
  changements: Partial<Pick<CreerUtilisateurRequete, "role">> & {
    actif?: boolean;
    mot_de_passe?: string;
  },
): Promise<unknown> {
  return fetchAPI(
    `/admin/utilisateurs/${id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changements),
    },
    false,
    TIMEOUT_MUTATION_MS,
  );
}

export async function listerPatients(): Promise<PatientAdmin[]> {
  return fetchAPI<PatientAdmin[]>("/admin/patients");
}

export async function creerPatient(requete: CreerPatientRequete): Promise<PatientAdmin> {
  return fetchAPI<PatientAdmin>(
    "/admin/patients",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requete),
    },
    false,
    TIMEOUT_MUTATION_MS,
  );
}

export async function renvoyerOtp(
  idPatient: number,
): Promise<{ statut: string; canal: string; contact?: string }> {
  return fetchAPI(
    `/admin/patients/${idPatient}/renvoyer-otp`,
    { method: "POST" },
    false,
    TIMEOUT_MUTATION_MS,
  );
}

/* ------------------------------- Accès patient --------------------------- */

/** Un diagnostic (une analyse) avec ses verdicts, tel que rendu au patient.
 *  Un OTP ne délivre qu'UN compte rendu : la dernière analyse du patient
 *  (voir dernier-resultat.ts). Plusieurs diagnostics peuvent historiquement
 *  partager le même id_examen — le backend borne déjà sa réponse à un seul. */
export type ResultatOtp = {
  id_diagnostic: string;
  id_examen?: number;
  code_examen?: string;
  nom_fichier?: string;
  execute_le?: string;
  /** Clé effectivement renvoyée par le backend (execute_le est l'ancien nom). */
  horodatage?: string;
  resultats: Array<{
    pathologie: string;
    prediction: string;
    confiance: number;
  }>;
  destination?: string;
  temps_total_ms?: number;
};

export type ReponseAccesResultat = {
  patient: { code_patient: string; nom_complet: string | null };
  resultats: ResultatOtp[];
};

/** POST /acces-resultat — OTP 6 chiffres + email -> dossier patient (texte seul). */
/**
 * Vérifie un OTP via l'email OU le numéro WhatsApp saisi par le patient.
 * Un seul des deux contacts est requis (celui qui a reçu le code).
 */
export async function verifierOtp(
  codeOtp: string,
  contact: { email?: string; telephone?: string },
): Promise<ReponseAccesResultat> {
  const data = await fetchAPI<ReponseAccesResultat>(
    "/acces-resultat",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code_otp: codeOtp,
        email: contact.email ?? null,
        telephone: contact.telephone ?? null,
      }),
    },
    false,
    TIMEOUT_MUTATION_MS,
  );
  return data;
}
