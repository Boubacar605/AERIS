/**
 * Store d'authentification — session JWT en `sessionStorage`.
 *
 * Même pattern que `resultat-store` : un état module + `useSyncExternalStore`.
 *
 * Choix de sécurité : la session vit dans `sessionStorage`, pas
 * `localStorage`. Le navigateur vide `sessionStorage` à la fermeture de
 * l'onglet ou du navigateur : toute nouvelle visite exige donc une
 * authentification, ce qu'un `localStorage` ne garantit pas (il conserve le
 * jeton indéfiniment). Un rechargement (F5) de la page conserve en revanche la
 * session, qui reste liée à l'onglet courant et disparaît avec lui.
 *
 * Une ancienne session `localStorage` (version antérieure du code) est
 * systématiquement purgée à la première lecture : un jeton d'accès valide ne
 * doit pas survivre à une déconnexion dans le stockage persistant.
 *
 * Compatibilité SSR : la lecture synchrone du stockage est différée au premier
 * appel côté client. `useSession` ne renvoie une session qu'après l'hydratation
 * effectuée par <RootComponent> (voir __root.tsx), ce qui évite tout désaccord
 * serveur / client au premier rendu.
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
let hydrate = false; // passe à vrai dès que la session a été lue depuis le stockage
let pret = false; // mémorise si on a déjà (tenté de) lire le stockage
const ecouteurs = new Set<() => void>();

function notifier() {
  for (const ecoute of ecouteurs) ecoute();
}

/**
 * Purge une éventuelle session laissée dans `localStorage` par une version
 * antérieure : ce stockage survit à la déconnexion, contrairement à
 * `sessionStorage`, et conserverait un jeton d'accès valide.
 */
function purgerSessionPersistante(): void {
  try {
    window.localStorage.removeItem(CLE_SESSION);
  } catch {
    /* stockage indisponible : rien à purger */
  }
}

/** Lit la session depuis sessionStorage (une seule fois), côté client uniquement. */
function lierSessionClient(): void {
  if (pret || typeof window === "undefined") return;
  pret = true;
  purgerSessionPersistante();
  try {
    const brut = window.sessionStorage.getItem(CLE_SESSION);
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
      if (valeur) window.sessionStorage.setItem(CLE_SESSION, JSON.stringify(valeur));
      else window.sessionStorage.removeItem(CLE_SESSION);
    } catch {
      /* stockage indisponible : la session reste en mémoire */
    }
  }
  notifier();
}

/** Déconnexion : efface la session (stockage compris). */
export function deconnecter(): void {
  definirSession(null);
}

/**
 * Lecture non réactive de la session (handlers, `beforeLoad`, client API).
 * Lit le stockage si nécessaire : c'est la session « vraie » de l'onglet.
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
