/**
 * Store d'authentification — session JWT persistée en localStorage.
 *
 * Même pattern que `resultat-store` : un état module + `useSyncExternalStore`.
 * La session survit au rechargement (localStorage) mais reste limitée au
 * navigateur courant (pas de cookies, pas d'entre-navigateurs).
 *
 * Compatibilité SSR : la lecture synchrone de localStorage est différée au
 * premier appel côté client. `useSession` ne renvoie une session qu'après
 * l'hydratation effectuée par <RootComponent> (voir __root.tsx), ce qui
 * évite tout désaccord serveur / client au premier rendu.
 */

import { useSyncExternalStore } from "react";

export type RoleUtilisateur = "admin" | "clinicien";

export type Session = {
  personne: {
    id_utilisateur: number;
    email: string;
    nom: string;
    prenom: string;
    role: RoleUtilisateur;
  };
  acces_token: string;
  rafraichissement_token: string;
  /** Date d'expiration (ISO) du jeton d'accès. */
  expire_le: string;
};

const CLE_SESSION = "aeris.session";

let session: Session | null = null;
let hydrate = false; // passe à vrai dès que la session a été lue depuis localStorage
let pret = false; // mémorise si on a déjà (tenté de) lire localStorage
const ecouteurs = new Set<() => void>();

function notifier() {
  for (const ecoute of ecouteurs) ecoute();
}

/** Lit la session depuis localStorage (une seule fois), côté client uniquement. */
function lierSessionClient(): void {
  if (pret || typeof window === "undefined") return;
  pret = true;
  try {
    const brut = window.localStorage.getItem(CLE_SESSION);
    if (brut) session = JSON.parse(brut) as Session;
  } catch {
    session = null; // stockage corrompu : on repart d'un état vierge
  }
}

/** Pose (ou efface si null) la session, puis prévient les abonnés. */
export function definirSession(valeur: Session | null): void {
  session = valeur;
  if (typeof window !== "undefined") {
    try {
      if (valeur) window.localStorage.setItem(CLE_SESSION, JSON.stringify(valeur));
      else window.localStorage.removeItem(CLE_SESSION);
    } catch {
      /* stockage indisponible : la session reste en mémoire */
    }
  }
  notifier();
}

/** Déconnexion : efface la session (localStorage compris). */
export function deconnecter(): void {
  definirSession(null);
}

/**
 * Lecture non réactive de la session (handlers, `beforeLoad`, client API).
 * Lit localStorage si nécessaire : c'est la session « vraie » du navigateur.
 */
export function obtenirSession(): Session | null {
  lierSessionClient();
  return session;
}

/**
 * Hydratation explicite appelée par le composant racine côté client.
 * Marque l'état comme hydraté puis re-notifie : les abonnés passent alors
 * d'une vue « non connecté » à une vue « connecté » sans rechargement.
 */
export function hydraterSession(): void {
  lierSessionClient();
  if (!hydrate) {
    hydrate = true;
    notifier();
  }
}

/** Vrai une fois la session hydratée côté client (lecture non réactive). */
export function sessionHydratee(): boolean {
  return hydrate;
}

/** Réagit à la session (nulle jusqu'à l'hydratation, y compris côté serveur). */
export function useSession(): Session | null {
  return useSyncExternalStore(
    (ecoute) => {
      ecouteurs.add(ecoute);
      return () => {
        ecouteurs.delete(ecoute);
      };
    },
    () => (hydrate ? session : null),
    () => null, // instantané serveur : toujours déconnecté
  );
}

/** Utilisateur connecté (après hydratation), ou null. */
export function useUtilisateur() {
  return useSession()?.personne ?? null;
}

/** Rôle de l'utilisateur connecté, ou null. */
export function useRole(): RoleUtilisateur | null {
  return useSession()?.personne.role ?? null;
}
