/**
 * Gardes d'acheminement et table des rôles requis par chemin.
 *
 * Deux mécanismes complémentaires, et **les deux s'exécutent** :
 * - `beforeLoad` (navigation TanStack) : redirige immédiatement, côté client ;
 * - la table `ROLES_POUR_PREFIXE`, relue par `GardeAcheminement` dans
 *   `routes/__root.tsx` après hydratation.
 *
 * ⚠️ Le second rattrape le premier. Supprimer une garde `beforeLoad` ne
 * désactive donc PAS l'accès : tant que le chemin reste dans la table, le
 * garde racine renvoie l'anonyme vers /login. C'est ce qui rendait le portail
 * patient `/resultat` inatteignable — le chemin était dans la table, alors
 * qu'un patient n'a pas de session. Retirer l'entrée de la table est donc
 * obligatoire, pas optionnel.
 *
 * La navigation de l'AppShell utilise ses propres `roles` par lien, pas cette
 * table : modifier la table ne change pas le menu.
 *
 * Côté serveur la session est inconnue (sessionStorage) : les gardes sont des
 * no-op pendant le SSR et le contrôle réel s'effectue au client, juste après
 * hydratation.
 */

import { redirect } from "@tanstack/react-router";
import { obtenirSession, type RoleUtilisateur } from "@/lib/authentification-store";

/**
 * Rôles autorisés sur chaque préfixe de chemin.
 * Admin = profil IT (monitoring, comptes, audit) ; clinicien = soins (analyse,
 * historique). L'admin ne réalise JAMAIS de diagnostic : /diagnostic reste
 * réservé au clinicien.
 */
export const ROLES_POUR_PREFIXE: ReadonlyArray<{
  prefix: string;
  roles: readonly RoleUtilisateur[];
}> = [
  { prefix: "/admin", roles: ["admin"] },
  { prefix: "/dashboard", roles: ["admin"] },
  { prefix: "/monitoring", roles: ["admin"] },
  { prefix: "/architecture", roles: ["admin"] },
  { prefix: "/settings", roles: ["admin"] },
  { prefix: "/diagnostic", roles: ["clinicien"] },
  { prefix: "/patients", roles: ["clinicien"] },
  { prefix: "/suivi", roles: ["clinicien"] },
  { prefix: "/triage", roles: ["clinicien"] },
  { prefix: "/poste", roles: ["clinicien"] },
  { prefix: "/protocole", roles: ["clinicien"] },
  { prefix: "/historique", roles: ["admin", "clinicien"] },
];

/** Rôles requis pour un chemin, ou null si le chemin est public. */
export function rolesRequisesPour(chemin: string): readonly RoleUtilisateur[] | null {
  for (const { prefix, roles } of ROLES_POUR_PREFIXE) {
    if (chemin === prefix || chemin.startsWith(`${prefix}/`)) return roles;
  }
  return null;
}

/** Destination par défaut après connexion, selon le rôle. */
export function pageAccueilPourRole(role: RoleUtilisateur): string {
  return role === "admin" ? "/dashboard" : "/poste";
}

/**
 * Garde `beforeLoad` : exige une session (connexion).
 * No-op pendant le SSR ; redirige vers /login côté client si absent.
 */
export function exigerConnexion(): void {
  if (typeof window === "undefined") return;
  if (!obtenirSession()) {
    throw redirect({
      to: "/login",
      search: { retro: window.location.pathname + window.location.search },
    });
  }
}

/**
 * Garde `beforeLoad` : exige une session avec l'un des rôles donnés.
 * No-op pendant le SSR ; redirige vers la page d'accueil du rôle sinon.
 */
export function exigerRole(...roles: RoleUtilisateur[]): void {
  exigerConnexion();
  if (typeof window === "undefined") return;
  const session = obtenirSession();
  if (session && !roles.includes(session.personne.role)) {
    throw redirect({ to: pageAccueilPourRole(session.personne.role) });
  }
}
