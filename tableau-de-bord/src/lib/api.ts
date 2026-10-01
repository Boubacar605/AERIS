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
 * Extrait le message d'erreur métier renvoyé par FastAPI.
 *
 * FastAPI répond `{"detail": "..."}` (ou `detail` en liste pour les erreurs
 * de validation 422). Sans cette lecture, l'interface ne peut afficher qu'un
 * « API 409 sur /routage/patient » : le clinicien ne sait pas qu'un numéro
 * appartient déjà à un autre patient, et le message lui semble arbitraire.
 * On retombe donc sur un libellé lisible par route si le corps est vide.
 */
async function messageErreurApi(res: Response, chemin: string): Promise<string> {
  let detail: unknown;
  try {
    detail = (await res.clone().json())?.detail;
  } catch {
    detail = undefined;
  }
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length) {
    // 422 pydantic : on ne garde que les messages lisibles.
    const messages = detail
      .map((d: { msg?: string; loc?: unknown[] }) =>
        typeof d?.msg === "string" ? d.msg : undefined,
      )
      .filter((m): m is string => Boolean(m));
    if (messages.length) return messages.join(" ; ");
  }
  const defauts: Record<number, string> = {
    401: "Session expirée, reconnectez-vous.",
    403: "Droits insuffisants pour cette action.",
    404: "Ressource introuvable.",
    409: "Conflit : la ressource existe déjà.",
    422: "Données invalides.",
    503: "Service momentanément indisponible.",
  };
  return defauts[res.status] ?? `Erreur ${res.status} sur ${chemin}`;
}

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
  if (!res.ok) throw new ApiError(res.status, await messageErreurApi(res, path));
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
  if (!res.ok) throw new ApiError(res.status, await messageErreurApi(res, "/routage/analyser"));
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

/** Fiche existante retrouvée par numéro — GET /routage/patient?telephone=… */
export type FichePatientTelephonique = {
  trouve: boolean;
  id_patient?: number | null;
  code_patient?: string | null;
  nom?: string | null;
  prenom?: string | null;
  nom_complet?: string | null;
  email?: string | null;
  date_naissance?: string | null;
  telephone_normalise?: string | null;
};

/**
 * GET /routage/patient — recherche une fiche existante par numéro.
 *
 * Utilisé pendant la saisie du formulaire « Diagnostic » pour pré-remplir
 * l'identité : un numéro déjà connu rattache l'examen à la bonne fiche sans
 * ressaisie. Lecture seule — la validation reste portée par
 * `trouverOuCreerPatient`.
 */
export async function rechercherPatientParTelephone(
  telephone: string,
  signal?: AbortSignal,
): Promise<FichePatientTelephonique> {
  const requete = encodeURIComponent(telephone.trim());
  return fetchAPI<FichePatientTelephonique>(
    `/routage/patient?telephone=${requete}`,
    signal ? { method: "GET", signal } : { method: "GET" },
    false,
    TIMEOUT_POLLING_MS,
  );
}

/** Réponse de l'approbation : le patient reçoit son OTP par email et/ou WhatsApp. */
export type ReponseApprobation = {
  /**
   * - `otp_envoye` : tous les canaux visés ont abouti ;
   * - `otp_partiellement_envoye` : au moins un canal a abouti, au moins un
   *   autre est indisponible (relais WhatsApp hors ligne, par exemple) ;
   * - `echec_envoi` : aucun canal n'a abouti.
   */
  statut: "otp_envoye" | "otp_partiellement_envoye" | "echec_envoi";
  canal: "email+whatsapp" | "whatsapp" | "email" | "aucun";
  contact?: string;
  /** Succès par canal : un `false` signale un compteur en panne. */
  canaux?: Partial<Record<"email" | "whatsapp", boolean>>;
  /** Canaux ayant effectivement reçu l'OTP. */
  canaux_oks?: Array<"email" | "whatsapp">;
  /** Messages à afficher au clinicien (canal en panne, etc.). */
  avertissements?: string[];
  /** Ligne du journal de validation créée par l'approbation (Vague 1). */
  validation?: EtatValidation;
};

/**
 * POST /admin/examens/approuver — bouton « Approuver » de la page Résultat :
 * envoie le code OTP validé au patient (email + WhatsApp si adresse connue,
 * sinon WhatsApp seul ; le lien de consultation reste dans chaque message).
 *
 * La décision porte sur `id_examen` et non sur le patient : approuver un
 * dossier entier reviendrait à libérer aussi les examens que le clinicien n'a
 * pas regardés.
 */
export async function approuverExamen(
  idExamen: number,
  noteClinique?: string,
): Promise<ReponseApprobation> {
  return fetchAPI<ReponseApprobation>(
    "/admin/examens/approuver",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_examen: idExamen, note_clinique: noteClinique ?? null }),
    },
    false,
    TIMEOUT_MUTATION_MS,
  );
}

/** Réponse de POST /admin/examens/desapprouver (Vague 1). */
export type ReponseDesapprobation = {
  statut: "desapprouve";
  /** Nombre de codes patient révoqués (l'accès au compte rendu est coupé). */
  otp_revoques: number;
  validation: EtatValidation;
};

/**
 * POST /admin/examens/desapprouver — refuse le compte rendu et retire au
 * patient l'accès aux codes déjà envoyés. Le motif est obligatoire : c'est lui
 * qui rend le désaccord relisible, le journal étant conservé en ajout.
 */
export async function desapprouverExamen(
  idExamen: number,
  motifDesaccord: string,
): Promise<ReponseDesapprobation> {
  return fetchAPI<ReponseDesapprobation>(
    "/admin/examens/desapprouver",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_examen: idExamen, motif_desaccord: motifDesaccord }),
    },
    false,
    TIMEOUT_MUTATION_MS,
  );
}

/* --------------------- Dossier clinique et suivis (Vague 1) ---------------- */

/**
 * Décision clinique portant sur UN examen.
 *
 * `sans_decision` est l'état le plus fréquent : les examens antérieurs à la
 * Vague 1 n'ont jamais été validés, et on ne fabrique pas une traçabilité qui
 * n'a pas existé. Un journal en ajout (`validations_cliniques`) conserve
 * l'historique complet des approbations et désaccords.
 */
export type EtatValidation = {
  statut: "sans_decision" | "en_attente" | "approuve" | "desapprouve" | "sans_base";
  id_validation?: number;
  note_clinique?: string | null;
  motif_desaccord?: string | null;
  horodatage?: string;
  /** Compte ayant rendu la décision. */
  par?: string | null;
};

/** Verdict clinique d'une pathologie, sans aucune donnée d'infrastructure. */
export type VerdictClinique = {
  pathologie: string;
  prediction: string;
  confiance: number;
  determinant: boolean;
};

/** Une ligne de la page /patients : un dossier, son dernier verdict, sa validation. */
export type DossierClinique = {
  id_patient: number;
  code_patient: string;
  nom_complet: string | null;
  sexe?: string | null;
  annee_naissance?: number | null;
  telephone?: string | null;
  nb_examens: number;
  dernier_examen_le?: string | null;
  /** Verdict le plus déterminant du dernier examen (positif le plus confiant). */
  dernier_verdict?: VerdictClinique | null;
  validation: EtatValidation;
};

/** Un examen dans la chronologie d'un patient. */
export type ExamenChronologie = {
  id_examen: number;
  code_examen?: string | null;
  nom_fichier?: string | null;
  horodatage?: string | null;
  resultats: VerdictClinique[];
  validation: EtatValidation;
};

/** GET /patients/{code_patient} — dossier complet et chronologie. */
export type ChronologiePatient = {
  id_patient: number;
  code_patient: string;
  nom_complet: string | null;
  sexe?: string | null;
  annee_naissance?: number | null;
  telephone?: string | null;
  email?: string | null;
  note?: string | null;
  examens: ExamenChronologie[];
};

/** GET /patients — dossiers du clinicien, le plus récemment examiné d'abord. */
export async function listerDossiersPatients(): Promise<DossierClinique[]> {
  return fetchAPI<DossierClinique[]>("/patients", { method: "GET" });
}

/** GET /patients/{code_patient} — chronologie clinique d'un dossier. */
export async function lireChronologiePatient(codePatient: string): Promise<ChronologiePatient> {
  return fetchAPI<ChronologiePatient>(`/patients/${encodeURIComponent(codePatient.trim())}`, {
    method: "GET",
  });
}

/** Un examen dans la file de triage : tout ce qu'il faut pour décider vite. */
export type ExamenTriage = {
  id_examen: number;
  id_diagnostic: number;
  id_patient: number;
  code_patient: string;
  nom_complet: string | null;
  sexe?: string | null;
  annee_naissance?: number | null;
  code_examen?: string | null;
  nom_fichier?: string | null;
  horodatage?: string | null;
  /**
   * Faux si le patient n'a ni téléphone ni e-mail : l'approbation émet un OTP
   * au patient et serait refusée par l'API. La file le dit en amont.
   */
  contact_disponible: boolean;
  resultats: VerdictClinique[];
  /** Positif le plus confiant, ou `null` si tous les verdicts sont négatifs. */
  verdict_principal?: VerdictClinique | null;
  validation: EtatValidation;
  /** Jours entiers écoulés depuis l'analyse : 0 pour un examen de la journée. */
  jours_attente: number;
  /** Dérive du délai, recalculé à chaque lecture — jamais stocké. */
  alerte: boolean;
};

/** GET /triage — file d'attente et alertes de la Vague 2. */
export type FileTriage = {
  seuil_alerte_jours: number;
  examens: ExamenTriage[];
  alertes: ExamenTriage[];
};

/** GET /triage — examens en attente de décision, le plus ancien d'abord. */
export async function lireFileTriage(seuilAlerteJours = 2): Promise<FileTriage> {
  return fetchAPI<FileTriage>(`/triage?seuil_alerte_jours=${seuilAlerteJours}`, {
    method: "GET",
  });
}

/** Un contrôle à venir, tel que présenté au clinicien. */
export type SuiviClinique = {
  id_suivi: number;
  id_patient: number;
  code_patient: string;
  nom_complet: string | null;
  id_examen_origine?: number | null;
  code_examen?: string | null;
  date_suivi?: string | null;
  motif?: string | null;
  statut: "planifie" | "realise" | "annule";
  cree_le?: string | null;
};

/** GET /suivis — échéance la plus proche d'abord, honnis/annulés en fin de liste. */
export async function listerSuivis(limite = 200): Promise<SuiviClinique[]> {
  return fetchAPI<SuiviClinique[]>(`/suivis?limite=${limite}`, { method: "GET" });
}

/** POST /suivis — programme un contrôle à venir. */
/**
 * Suivi tel que renvoyé par la **création**. Distinct de `SuiviClinique` : la
 * création ne fait pas la jointure sur le patient, donc `code_patient`,
 * `nom_complet` et `code_examen` sont absents. Déclarer le type complet ici
 * ferait afficher `undefined` comme si c'était une valeur.
 */
export type SuiviCree = {
  id_suivi: number;
  id_patient: number;
  id_examen_origine?: number | null;
  date_suivi?: string | null;
  motif?: string | null;
  statut: "planifie" | "realise" | "annule";
  cree_le?: string | null;
};

export async function creerSuivi(requete: {
  id_patient: number;
  date_suivi: string;
  motif?: string | null;
  id_examen_origine?: number | null;
}): Promise<SuiviCree> {
  return fetchAPI<SuiviCree>(
    "/suivis",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requete),
    },
    false,
    TIMEOUT_MUTATION_MS,
  );
}

/** PATCH /suivis/{id_suivi} — « réalisé » ou « annulé » ; rien n'est supprimé. */
export async function changerStatutSuivi(
  idSuivi: number,
  statut: "realise" | "annule",
): Promise<{ id_suivi: number; statut: string }> {
  return fetchAPI<{ id_suivi: number; statut: string }>(
    `/suivis/${idSuivi}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statut }),
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
  /**
   * Examen créé en base pour cette analyse (Vague 1). C'est cet identifiant
   * que la décision clinique (approbation, désaccord) référence : sans lui, on
   * ne sait pas quel examen le clinicien a validé.
   */
  id_examen?: number | null;
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
  /**
   * Décision du clinicien sur cet examen (Vague 1). Permet d'afficher un
   * bandeau au patient plutôt qu'un refus muet : il sait qu'une validation est
   * en cours, et non que le système est en panne.
   */
  validation?: EtatValidation;
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

/**
 * Une recommandation de prise en charge (Vague 2).
 *
 * `cible` sépare les deux lecteurs : le clinicien voit l'orientation de travail,
 * le patient voit ce qu'il doit faire. Les deux listes sont produites à partir
 * des mêmes verdicts mais ne se recoupent pas.
 *
 * Ce n'est **pas** une prescription : le module serveur s'interdit tout nom de
 * médicament et toute posologie, et un test le vérifie.
 */
export type RecommandationClinique = {
  texte: string;
  cible: "clinicien" | "patient";
  /** Ce qui a déclenché la recommandation — traçabilité côté poste. */
  motif: string;
  pathologie?: string | null;
  confiance?: number | null;
  tags: string[];
};

/** GET /recommandations/{id_examen} */
export type ReponseRecommandations = {
  id_examen: number;
  validation: EtatValidation;
  recommandations: RecommandationClinique[];
};

/** GET /recommandations/{idExamen} — orientations de prise en charge. */
export async function lireRecommandations(idExamen: number): Promise<ReponseRecommandations> {
  return fetchAPI<ReponseRecommandations>(`/recommandations/${idExamen}`, { method: "GET" });
}

/** POST /examens/{idExamen}/partager — renvoie le résumé par WhatsApp. */
export type PartageCompteRendu = {
  id_examen: number;
  canal: "whatsapp";
  envoye: boolean;
  /** Vrai quand aucun relais n'est configuré : l'envoi est journalisé, pas transmis. */
  simulation: boolean;
  nb_recommandations: number;
};

/**
 * Partage le compte rendu validé d'un examen par WhatsApp.
 *
 * L'API refuse un examen non approuvé : l'erreur 409 est remontée telle quelle
 * plutôt que masquée.
 */
export async function partagerCompteRendu(idExamen: number): Promise<PartageCompteRendu> {
  return fetchAPI<PartageCompteRendu>(
    `/examens/${idExamen}/partager`,
    { method: "POST" },
    false,
    TIMEOUT_MUTATION_MS,
  );
}

/**
 * GET /protocole — agrégats de la file de validation (Vague 2).
 *
 * `taux_validation` est nullable : sans examen approuvé, afficher « 0 % » se
 * lirait comme un indicateur de performance alors que c'est une absence de
 * donnée. La page affiche alors « — ».
 */
export type ProtocoleValidation = {
  examens_analyses: number;
  examens_approuves: number;
  examens_desapprouves: number;
  examens_en_attente: number;
  examens_non_approuves: number;
  decisions_journalisees: number;
  otp_revoques: number;
  controles_a_venir: number;
  delai_moyen_heures: number;
  taux_validation: number | null;
};

/** GET /protocole — charge de travail et décisions cliniques du poste. */
export async function lireProtocoleValidation(): Promise<ProtocoleValidation> {
  return fetchAPI<ProtocoleValidation>("/protocole", { method: "GET" });
}

/**
 * GET /poste/synthese — tableau de bord du poste clinicien.
 *
 * Une seule lecture agrégée plutôt qu'une par page : six requêtes
 * produiraient six instantanés du même état, et deux chiffres du tableau de
 * bord pourraient se contredire d'un affichage à l'autre.
 *
 * **Unité de compte : l'examen.** Les diagnostics sont rejoués à chaque
 * analyse et par la passe de charge des scénarios (1 010 lignes pour 25
 * examens) : les compter comme des actes de soin afficherait un pic
 * artificiel. Les verdicts, eux, sont portés par le *dernier* diagnostic de
 * chaque examen, jamais par l'historique complet.
 *
 * Aucun champ technique n'est exposé : destination Edge/Cloud, CPU, RAM et
 * latence restent réservés à l'admin.
 */
export type SynthesePoste = {
  seuil_alerte_jours: number;
  file: {
    a_valider: number;
    en_retard: number;
    age_max_jours: number;
    valides: number;
    desapproves: number;
    jamais_analyses: number;
    total_examens: number;
    examens_analyses: number;
    anciennete: { tranche: string; examens: number }[];
  };
  patients: { dossiers: number; joignables: number };
  validations: {
    taux_validation: number | null;
    delai_moyen_heures: number;
    decisions_journalisees: number;
  };
  activite: { jour: string; examens: number }[];
  decisions_par_jour: { jour: string; decisions: number }[];
  verdits_par_pathologie: {
    pathologie: string;
    negatif: number;
    positif: number;
    indetermine: number;
  }[];
  suivis: {
    a_venir: {
      date_suivi: string | null;
      statut: string;
      code_patient: string;
      motif: string | null;
    }[];
    par_statut: Record<string, number>;
    total: number;
    realises: number;
  };
};

/** GET /poste/synthese — synthèse clinique du poste, une seule lecture. */
export async function lireSynthesePoste(seuilAlerteJours = 2): Promise<SynthesePoste> {
  return fetchAPI<SynthesePoste>(`/poste/synthese?seuil_alerte_jours=${seuilAlerteJours}`, {
    method: "GET",
  });
}
