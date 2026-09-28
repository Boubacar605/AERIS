/**
 * Mini-store en mémoire pour partager le dossier d'un examen entre la page
 * Diagnostic (qui produit le résultat) et la page Résultat (compte rendu).
 *
 * Choix volontaire : aucune dépendance, aucun localStorage — un rechargement
 * de /resultat perd le dossier et la page affiche son état vide (le soignant
 * revient au diagnostic). L'état ne contient que des objets déjà en mémoire
 * (le File est conservé tel quel, l'object URL est recréé par la visionneuse).
 */

import { useSyncExternalStore } from "react";
import type { ResultatAnalyse } from "@/lib/api";

export type DossierPatient = {
  code_patient: string;
  nom_complet: string | null;
  /**
   * Identifiant base du patient : cible d'un suivi programmé depuis la page
   * Résultat. Absent d'un dossier produit avant la Vague 1, où la
   * programmation est alors refusée plutôt que devinée depuis le code.
   */
  id_patient?: number | null;
};

export type DossierResultat = {
  /** Fichier radiographie original, transmis depuis la page diagnostic. */
  fichier: File;
  /** Résultat complet de l'analyse (verdicts, profilage, contrôle qualité). */
  resultat: ResultatAnalyse;
  /** Moment où l'examen a été produit (ISO), affiché dans le compte rendu. */
  horodatage: string;
  /** Patient lié à l'examen (code AER-AAAA-NNNN) : sert à l'approbation OTP. */
  patient: DossierPatient;
  /**
   * Examen validé côté base (Vague 1) : c'est lui que la décision clinique
   * porte. Un dossier sans identifiant provient d'un examen antérieur à la
   * Vague 1 ; l'approbation est alors refusée plutôt que d'approuver le
   * dossier entier par défaut.
   */
  id_examen?: number | null;
};

let dossier: DossierResultat | null = null;
const ecouteurs = new Set<() => void>();

function notifier() {
  for (const l of ecouteurs) l();
}

/** Dépose (ou efface si null) le dossier à partager, et prévient les abonnés. */
export function definirResultat(valeur: DossierResultat | null): void {
  dossier = valeur;
  notifier();
}

/** Lecture non réactive (pour handlers appelés hors rendu). */
export function obtenirResultat(): DossierResultat | null {
  return dossier;
}

/** Abonnement réactif au dossier courant. */
export function useResultat(): DossierResultat | null {
  return useSyncExternalStore(
    (ecoute) => {
      ecouteurs.add(ecoute);
      return () => {
        ecouteurs.delete(ecoute);
      };
    },
    obtenirResultat,
    obtenirResultat,
  );
}
